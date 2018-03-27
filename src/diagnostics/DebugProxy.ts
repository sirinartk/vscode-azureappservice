/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { User } from 'azure-arm-website/lib/models';
import * as EventEmitter from 'events';
import { createServer, Server, Socket } from 'net';
import { OutputChannel } from 'vscode';
import { pingFunctionApp, SiteClient } from 'vscode-azureappservice';
import * as websocket from 'websocket';

export class DebugProxy extends EventEmitter {
    private _server: Server | undefined;
    private _wsclient: websocket.client | undefined;
    private _wsconnection: websocket.connection | undefined;
    private _client: SiteClient;
    private _port: number;
    private _publishCredential: User;
    private _keepAlive: boolean;
    private _outputChannel: OutputChannel;
    private _openSockets: Array<Socket>;

    constructor(outputChannel: OutputChannel, client: SiteClient, port: number, publishCredential: User) {
        super();
        this._client = client;
        this._port = port;
        this._publishCredential = publishCredential;
        this._keepAlive = true;
        this._outputChannel = outputChannel;
        this._server = createServer();
        this._openSockets = []
    }

    public async startProxy(): Promise<void> {

        if (!this._server) {
            this.emit('error', new Error('Proxy server is not started.'));
        } else {
            // wake up the function app before connecting to it.
            //await this.keepAlive();
            this._wsclient = new websocket.client();

            this._wsclient.on('connect', (connection: websocket.connection) => {
                this._outputChannel.appendLine('[WebSocket] client connected');
                this._wsconnection = connection;

                connection.on('close', () => {
                    this._outputChannel.appendLine('[WebSocket] client closed');
                    this.dispose();
                    this._openSockets.forEach(socket => {
                        socket.destroy();
                    });
                    this.emit('end');
                });

                connection.on('error', (err: Error) => {
                    this._outputChannel.appendLine(`[WebSocket] ${err}`);
                    this.dispose();
                    this._openSockets.forEach(socket => {
                        socket.destroy();
                    });
                    this.emit('error', err);
                });

                connection.on('message', (data: websocket.IMessage) => {
                    this._openSockets.forEach(socket => {
                        socket.write(data.binaryData);
                    });
                });
                // socket.resume();
            });

            this._wsclient.on('connectFailed', (err: Error) => {
                this._outputChannel.appendLine(`[WebSocket] ${err}`);
                this.dispose();

                this._openSockets.forEach(socket => {
                    socket.destroy();
                });

                this.emit('error', err);
            });

            this._wsclient.connect(
                `wss://${this._client.kuduHostName}/AppServiceTunnel/Tunnel.ashx`,
                undefined,
                undefined,
                { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
                { auth: `${this._publishCredential.publishingUserName}:${this._publishCredential.publishingPassword}` }
            );

            this._server.on('connection', (socket: Socket) => {
                this._outputChannel.appendLine(`[Proxy Server] client connected ${socket.remoteAddress}:${socket.remotePort}`);
                // socket.pause();

                this._openSockets.push(socket)

                socket.on('data', (data: Buffer) => {
                    if (this._wsconnection) {
                        this._wsconnection.send(data);
                    }
                });

                socket.on('end', () => {
                    this._outputChannel.appendLine(`[Proxy Server] client disconnected ${socket.remoteAddress}:${socket.remotePort}`);
                    this.dispose();
                    this.emit('end');
                });

                socket.on('error', (err: Error) => {
                    this._outputChannel.appendLine(`[Proxy Server] ${err}`);
                    this.dispose();
                    socket.destroy();
                    this.emit('error', err);
                });

            });

            this._server.on('listening', () => {
                this._outputChannel.appendLine('[Proxy Server] start listening');
                this.emit('start');
            });

            this._server.listen({
                host: 'localhost',
                port: this._port,
                backlog: 1
            });
        }
    }

    public dispose(): void {
        if (this._wsconnection) {
            this._wsconnection.close();
            this._wsconnection = undefined;
        }
        if (this._wsclient) {
            this._wsclient.abort();
            this._wsclient = undefined;
        }
        if (this._server) {
            this._server.close();
            this._server = undefined;
        }

        this._openSockets.forEach(socket => {
            socket.destroy();
        });

        this._keepAlive = false;
    }

    //keep querying the function app state, otherwise the connection will lose.
    private async keepAlive(): Promise<void> {
        if (this._keepAlive) {
            try {
                await pingFunctionApp(this._client);
                setTimeout(this.keepAlive, 60 * 1000 /* 60 seconds */);
            } catch (err) {
                this._outputChannel.appendLine(`[Proxy Server] ${err}`);
                setTimeout(this.keepAlive, 5 * 1000 /* 5 seconds */);
            }
        }
    }
}
