/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IncomingMessage } from "http";
import * as path from 'path';
import { Disposable, Event, EventEmitter, FileChangeEvent, FileStat, FileSystemError, FileSystemProvider, FileType, Uri } from "vscode";
import { getFile, getKuduClient, IFileResult, putFile, SiteClient } from "vscode-azureappservice";
import { IAzureNode } from "vscode-azureextensionui";
import KuduClient from "vscode-azurekudu";
import { SiteTreeItem } from "./explorer/SiteTreeItem";
import { ext } from "./extensionVariables";

type kuduFile = { mime: string, name: string, path: string, mtime: string, crtime: string, size: number };
type kuduIncomingMessage = IncomingMessage & { body: string };

const directoryMime: string = 'inode/directory';

export class File implements FileStat {
    // tslint:disable-next-line:no-reserved-keywords
    public type: FileType;
    public ctime: number;
    public mtime: number;
    public size: number;
    public name: string;
    public entryPath: string;

    constructor(file: kuduFile) {
        this.type = FileType.File;
        this.ctime = Date.parse(file.crtime);
        this.mtime = Date.parse(file.mtime);
        this.size = file.size;
        this.name = file.name;
        // truncate the home of the path
        // the substring starts at file.path.indexOf(home) because the path sometimes includes site/ or D:\
        // the home.length + 1 is to account for the trailing slash, Linux uses / and Window uses \
        const home: string = 'home';
        this.entryPath = file.path.substring(file.path.indexOf(home) + home.length + 1);
    }
}

export class Directory extends File {
    private _entries: Map<string, Entry> | undefined;

    private _refreshingTask: Promise<Map<string, Entry>> | undefined;

    constructor(file: kuduFile) {
        super(file);
        this.type = FileType.Directory;
    }

    public async getEntry(kuduClient: KuduClient, name: string): Promise<Entry | undefined> {
        let entries: Map<string, Entry> | undefined = this._entries;
        if (!entries) {
            entries = await this.refreshEntries(kuduClient);
        }

        return entries.get(name);
    }

    public async getEntries(kuduClient: KuduClient): Promise<Map<string, Entry>> {
        let entries: Map<string, Entry> | undefined = this._entries;
        if (!entries) {
            entries = await this.refreshEntries(kuduClient);
        }

        return entries;
    }

    public async refreshEntries(kuduClient: KuduClient): Promise<Map<string, Entry>> {
        if (this._refreshingTask) {
            return await this._refreshingTask;
        } else {
            this._refreshingTask = this.actuallyRefreshEntries(kuduClient);
            try {
                const result: Map<string, Entry> = await this._refreshingTask;
                this._entries = result;
                return result;
            } finally {
                this._refreshingTask = undefined;
            }
        }
    }

    private async actuallyRefreshEntries(kuduClient: KuduClient): Promise<Map<string, Entry>> {
        const entries: Map<string, Entry> = new Map();
        const httpResponse: kuduIncomingMessage = <kuduIncomingMessage>(await kuduClient.vfs.getItemWithHttpOperationResponse(this.entryPath)).response;
        // response contains a body with a JSON parseable string
        const fileList: kuduFile[] = <kuduFile[]>JSON.parse(httpResponse.body);
        for (const file of fileList) {
            let entry: Entry;
            if (file.mime === 'inode/directory') {
                entry = new Directory(file);
            } else {
                entry = new File(file);
            }
            entries.set(file.name, entry);
        }

        return entries;
    }
}

export type Entry = File | Directory;

export class AppServiceFS implements FileSystemProvider {
    public onDidChangeFile: Event<FileChangeEvent[]>;
    private _emitter: EventEmitter<FileChangeEvent[]>;

    private _readonly: boolean;
    private _etags: Map<string, string> = new Map();
    private _roots: Map<string, Directory> = new Map();
    private _readonlyError: Error = FileSystemError.NoPermissions("Cannot modify in read-only mode.");

    public constructor(readonly: boolean) {
        this._readonly = readonly;
        this._emitter = new EventEmitter<FileChangeEvent[]>();
        this.onDidChangeFile = this._emitter.event;
    }

    public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
        const [siteClient, entryPath]: [SiteClient, string] = await parseAppServiceUri(uri);
        const entry: Entry = await this.lookup(siteClient, entryPath);
        if (entry instanceof Directory) {
            const kuduClient: KuduClient = await getKuduClient(siteClient);
            const entries: Map<string, Entry> = await entry.getEntries(kuduClient);
            const result: [string, FileType][] = [];
            for (const child of entries) {
                result.push([child[0], child[1].type]);
            }
            return result;
        } else {
            throw FileSystemError.FileNotADirectory(uri);
        }
    }

    public watch(_uri: Uri, _options: { recursive: boolean; excludes: string[]; }): Disposable {
        return new Disposable(() => {
            // ignore, fires for all changes...
        });
    }

    public async stat(uri: Uri): Promise<FileStat> {
        // todo telemetry/error display
        const [siteClient, entryPath]: [SiteClient, string] = await parseAppServiceUri(uri);
        return await this.lookup(siteClient, entryPath);
    }

    public async createDirectory(uri: Uri): Promise<void> {
        if (this._readonly) {
            throw this._readonlyError;
        }

        const [siteClient, entryPath]: [SiteClient, string] = await parseAppServiceUri(uri);
        await putFile(siteClient, '', entryPath.endsWith('/') ? entryPath : `${entryPath}/`);
        const parent: Directory = <Directory>await this.lookup(siteClient, path.dirname(entryPath));
        await parent.refreshEntries(await getKuduClient(siteClient));
    }

    public async readFile(uri: Uri): Promise<Uint8Array> {
        const [siteClient, entryPath]: [SiteClient, string] = await parseAppServiceUri(uri);
        const result: IFileResult = await getFile(siteClient, entryPath);
        this._etags.set(uri.path, result.etag);
        return Buffer.from(result.data);
    }

    // todo use options
    public async writeFile(uri: Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): Promise<void> {
        if (this._readonly) {
            throw this._readonlyError;
        }

        const [siteClient, entryPath]: [SiteClient, string] = await parseAppServiceUri(uri);
        const etag: string = await putFile(siteClient, content.toString(), entryPath, this._etags.get(uri.path));
        this._etags.set(uri.path, etag);
        const parent: Directory = <Directory>await this.lookup(siteClient, path.dirname(entryPath));
        await parent.refreshEntries(await getKuduClient(siteClient));
    }

    // tslint:disable-next-line:no-reserved-keywords
    public async delete(uri: Uri, options: { recursive: boolean; }): Promise<void> {
        if (this._readonly) {
            throw this._readonlyError;
        }

        const [siteClient, entryPath]: [SiteClient, string] = await parseAppServiceUri(uri);
        const entry: Entry = await this.lookup(siteClient, entryPath);
        let etag: string = '';
        if (entry.type === FileType.File) {
            const result: IFileResult = await getFile(siteClient, entryPath);
            etag = result.etag;
        }

        const kuduClient: KuduClient = await getKuduClient(siteClient);
        await kuduClient.vfs.deleteItem(entryPath, {
            recursive: options.recursive,
            customHeaders: { ['If-Match']: etag }
        });
        const parent: Directory = <Directory>await this.lookup(siteClient, path.dirname(entryPath));
        await parent.refreshEntries(await getKuduClient(siteClient));
    }

    public async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean; }): Promise<void> {
        if (this._readonly) {
            throw this._readonlyError;
        }

        throw new Error("Method not implemented.");
    }

    private async lookup(siteClient: SiteClient, entryPath: string): Promise<Entry> {
        const kuduClient: KuduClient = await getKuduClient(siteClient);
        let root: Directory | undefined = this._roots.get(siteClient.id);
        if (!root) {
            root = new Directory({ name: 'root', size: 0, mtime: new Date().toString(), crtime: new Date().toString(), mime: directoryMime, path: '' });
            this._roots.set(siteClient.id, root);
        }

        const parts = entryPath.split('/');
        let entry: Entry = root;
        for (const part of parts) {
            if (!part) {
                continue;
            }
            let child: Entry | undefined;
            if (entry instanceof Directory) {
                child = await entry.getEntry(kuduClient, part);
            }

            if (!child) {
                throw FileSystemError.FileNotFound(Uri.parse(`appService:/${siteClient.id}/${entry.entryPath}/${part}`));
            }
            entry = child;
        }
        return entry;
    }
}

// "/subscriptions/0b88671f-d5c2-45cf-8ee4-60c65fc6eee8/resourceGroups/appsvc_rg_linux_westus/providers/Microsoft.Web/sites/emj803/Log Files";
async function parseAppServiceUri(uri: Uri): Promise<[SiteClient, string]> {
    const matches: RegExpMatchArray | null = uri.path.match(/(\/subscriptions\/[^\/]+\/resourceGroups\/[^\/]+\/providers\/Microsoft\.Web\/sites\/[^\/]+)\/(.*)/);
    if (matches === null || matches.length < 3) {
        throw FileSystemError.FileNotFound(uri);
    }

    const siteId: string = matches[1];
    const entryPath: string = matches[2];
    const node: IAzureNode<SiteTreeItem> | undefined = <IAzureNode<SiteTreeItem> | undefined>await ext.tree.findNode(siteId);
    if (node) {
        return [node.treeItem.client, entryPath];
    } else {
        throw FileSystemError.Unavailable(uri);
    }
}
