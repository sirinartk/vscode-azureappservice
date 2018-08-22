/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { SiteClient } from 'vscode-azureappservice';
import { IAzureTreeItem } from 'vscode-azureextensionui';

export class FolderTreeItem implements IAzureTreeItem {
    public static contextValue: string = 'folder';
    public readonly contextValue: string = FolderTreeItem.contextValue;
    public readonly id: string;

    constructor(readonly client: SiteClient, readonly label: string, readonly folderPath: string, readonly commandId: string) {
        this.id = folderPath;
    }

    public get iconPath(): { light: string, dark: string } | undefined {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'light', 'Folder_16x.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'dark', 'Folder_16x.svg')
        };
    }
}

export type kuduFile = { mime: string, name: string, path: string };
