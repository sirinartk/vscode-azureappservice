/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteConfigResource, StringDictionary, User } from 'azure-arm-website/lib/models';
import * as portfinder from 'portfinder';
import * as vscode from 'vscode';
import * as opn from "opn";
import { SiteClient } from 'vscode-azureappservice';
import { DialogResponses, AzureTreeDataProvider, IAzureNode } from 'vscode-azureextensionui';
import { DebugProxy } from '../diagnostics/DebugProxy';
import { SiteTreeItem } from '../explorer/SiteTreeItem';
import { WebAppTreeItem } from '../explorer/WebAppTreeItem';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function startRemoteDebug(tree: AzureTreeDataProvider, node: IAzureNode<SiteTreeItem>, outputChannel: vscode.OutputChannel): Promise<void> {
    if (!node) {
        node = <IAzureNode<WebAppTreeItem>>await tree.showNodePicker(WebAppTreeItem.contextValue);
    }
    const client: SiteClient = node.treeItem.client;
    const sessionId: string = Date.now().toString();
    let debugConfig: vscode.DebugConfiguration;
    let debugRemotePort: Number;
    let debugProxy: DebugProxy;

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (p: vscode.Progress<{}>) => {

        p.report({ message: 'connecting to Azure...' });

        const portNumber: number = await portfinder.getPortPromise();
        const siteConfig: SiteConfigResource = await client.getSiteConfig();

        p.report({ message: 'detecting instance type...' });

        if (siteConfig.linuxFxVersion.startsWith('NODE')) {
            // Node
            debugConfig = {
                name: sessionId,
                type: 'node',
                protocol: "inspector",
                request: 'attach',
                address: 'localhost',
                port: portNumber,
                localRoot: vscode.workspace.rootPath,
                remoteRoot: "/home/site/wwwroot",
            }
            debugRemotePort = 9229;
        } else {
            throw 'Azure Remote Debugging is not supported for this instance type'
        }

        p.report({ message: 'checking app settings...' });

        // Use or update App Settings
        await new Promise(async (resolve: () => void, reject: (e: any) => void): Promise<void> => {
            const isEnabled = await isRemoteDebuggingEnabled(debugRemotePort, client);

            if (isEnabled) {
                // All good
                resolve();
            } else {
                const confirmMsg: string = 'We need to enable remote debugging for the selected app. Would you like to continue?';
                const result: vscode.MessageItem = await vscode.window.showWarningMessage(confirmMsg, DialogResponses.yes, DialogResponses.learnMore, DialogResponses.cancel);
                if (result === DialogResponses.learnMore) {
                    opn('https://aka.ms/');
                    reject('');
                } else {
                    p.report({ message: 'Updating application settings to enable remote debugging...' });
                    outputChannel.appendLine('Updating application settings to enable remote debugging...');
                    await updateAppSettings(debugRemotePort, client);

                    p.report({ message: 'Waiting for 60sec to let app reboot...' });
                    outputChannel.appendLine('Waiting for 60sec to let app reboot...');

                    // TODO: Get rid of hard-coded timeout and enable polling of app settings to make sure the setting is applied.
                    await delay(60000)

                    resolve();
                }
            }
        });

        // Setup Debug Proxy Tunnel
        await new Promise(async (resolve: () => void, reject: (e: any) => void): Promise<void> => {
            p.report({ message: 'starting debug proxy...' });
            outputChannel.appendLine('starting debug proxy...');

            const publishCredential: User = await client.getWebAppPublishCredential();
            debugProxy = new DebugProxy(outputChannel, client, debugConfig.port, publishCredential);
            debugProxy.on('error', (err: Error) => {
                debugProxy.dispose();
                reject(err)
                throw err;
            });
            debugProxy.on('start', resolve);

            debugProxy.startProxy();
        })

        // Start remote debugging
        p.report({ message: 'starting debugging...' });

        // Enable tracing for debug configuration
        debugConfig.trace = 'verbose'

        await vscode.debug.startDebugging(undefined, debugConfig);

        const terminateDebugListener: vscode.Disposable = vscode.debug.onDidTerminateDebugSession((event: vscode.DebugSession) => {
            if (event.name === sessionId) {
                if (debugProxy !== undefined) {
                    debugProxy.dispose();
                }
                terminateDebugListener.dispose();
            }
        });

        // TODO: Give up after 60sec, if something blows up along the way.

    });

}

async function isRemoteDebuggingEnabled(debugPort: Number, client: SiteClient): Promise<Boolean> {
    const appSettings: StringDictionary = await client.listApplicationSettings();
    if (appSettings.properties && appSettings.properties['APPSVC_TUNNEL_PORT'] === String(debugPort)) {
        // All good
        return true;
    } else {
        return false;
    }
}

async function updateAppSettings(debugPort: Number, client: SiteClient): Promise<void> {
    const appSettings: StringDictionary = await client.listApplicationSettings();

    appSettings.properties.APPSVC_TUNNEL_PORT = String(debugPort);
    await client.updateApplicationSettings(appSettings);
}
