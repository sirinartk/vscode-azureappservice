/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class ExplorerFS implements vscode.FileSystemProvider {
    public onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

    public watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }
    public stat(_uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        throw new Error("Method not implemented.");
    }
    public readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        throw new Error("Method not implemented.");
    }
    public createDirectory(_uri: vscode.Uri): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }
    public readFile(_uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        throw new Error("Method not implemented.");
    }
    public writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }
    // tslint:disable-next-line: no-reserved-keywords
    public delete(_uri: vscode.Uri, _options: { recursive: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }
    public rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }
    public copy?(_source: vscode.Uri, _destination: vscode.Uri, _options: { overwrite: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

}
