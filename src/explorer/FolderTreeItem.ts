/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IncomingMessage } from 'http';
import { workspace } from 'vscode';
import { ISiteTreeRoot } from 'vscode-azureappservice';
import { AzExtTreeItem, AzureParentTreeItem, AzureTreeItem, GenericTreeItem } from 'vscode-azureextensionui';
import { configurationSettings, extensionPrefix } from '../constants';
import { getThemedIconPath, IThemedIconPath } from '../utils/pathUtils';
import { FileTreeItem } from './FileTreeItem';
import { LogStreamTreeItem } from './LogStreamTreeItem';

export class FolderTreeItem extends AzureParentTreeItem<ISiteTreeRoot> {
    public static contextValue: string = 'folder';
    public readonly contextValue: string;
    public readonly childTypeLabel: string = 'files';

    private _openInFileExplorerString: string = 'Open in File Explorer...';

    constructor(parent: AzureParentTreeItem, readonly label: string, readonly folderPath: string, readonly subcontextValue?: string) {
        super(parent);
        this.contextValue = subcontextValue ? subcontextValue : FolderTreeItem.contextValue;
    }

    public get iconPath(): IThemedIconPath {
        return getThemedIconPath('Folder_16x');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<(AzExtTreeItem)[]> {
        const httpResponse: kuduIncomingMessage = <kuduIncomingMessage>(await this.root.client.kudu.vfs.getItemWithHttpOperationResponse(this.folderPath)).response;
        // response contains a body with a JSON parseable string
        const fileList: kuduFile[] = <kuduFile[]>JSON.parse(httpResponse.body);
        const home: string = 'home';
        const filteredList: kuduFile[] = fileList.filter((file: kuduFile) => {
            if (file.mime === 'text/xml' && file.name.includes('LogFiles-kudu-trace_pending.xml')) {
                // this file is being accessed by Kudu and is not viewable
                return false;
            }
            return true;
        });
        const children: AzExtTreeItem[] = filteredList.map((file: kuduFile) => {
            return file.mime === 'inode/directory' ?
                // truncate the home of the path
                // the substring starts at file.path.indexOf(home) because the path sometimes includes site/ or D:\
                // the home.length + 1 is to account for the trailing slash, Linux uses / and Window uses \
                new FolderTreeItem(this, file.name, file.path.substring(file.path.indexOf(home) + home.length + 1), 'subFolder') :
                new FileTreeItem(this, file.name, file.path.substring(file.path.indexOf(home) + home.length + 1));
        });
        if (this.contextValue === 'logFolder') {
            children.unshift(new LogStreamTreeItem(this));
        }
        // tslint:disable-next-line: strict-boolean-expressions
        if (workspace.getConfiguration(extensionPrefix).get(configurationSettings.enableViewInFileExplorer)) {
            const ti = new GenericTreeItem(this, {
                label: 'Open in File Explorer...',
                commandId: 'appService.openInFileExplorer',
                contextValue: 'openInFileExplorer'
            });

            ti.commandArgs = [this];

            children.push(ti);
        }
        return children;
    }

    public compareChildrenImpl(ti1: AzExtTreeItem, ti2: AzExtTreeItem): number {
        if (ti1.label === this._openInFileExplorerString) {
            return -1;
        } else if (ti2.label === this._openInFileExplorerString) {
            return 1;
        }

        return ti1.label.localeCompare(ti2.label);
    }

}

// tslint:disable-next-line:no-any
function instanceOfCompare<T>(ti1: AzureTreeItem, ti2: AzureTreeItem, typeToCompare: new (...args: any[]) => T): number | undefined {
    if (!(ti1 instanceof typeToCompare) && ti2 instanceof typeToCompare) {
        return 1;
    } else if (ti1 instanceof typeToCompare && !(ti2 instanceof typeToCompare)) {
        return -1;
    } else {
        return undefined;
    }
}

type kuduFile = { mime: string, name: string, path: string };
type kuduIncomingMessage = IncomingMessage & { body: string };
