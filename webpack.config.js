/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

// Full webpack documentation: [https://webpack.js.org/configuration/]().
// Using webpack helps reduce the install- and startup-time of large extensions because instead of hundreds of files, a single file is produced.

// How to fixing "dynamic require", "Module not found", "the request of a dependency is an expression" etc. webpack errors:
//
//   Webpack works by parsing all .ts/.js code, finding 'require' and 'import', and sucking in the target files directly
//   into the bundle. At runtime, the modified require/import looks into webpack's list of bundled modules.
//   Since this happens at compile time, if the module can't be found or the argument to require is an expression, this
//   causes problems (an error when webpacking and an exception at runtime).
//
//   These are common ways of fixing the problem:
//
//   1) Ask the source author to make the code webpack-friendly.
//
//     E.g. by removing the use of require for loading JSON files (see https://github.com/Microsoft/vscode-nls/commit/3ec7623fd86fc5e38895fe1ac594d2564bb2b755#diff-8cfead41d88ad47d44509a8ab0a109ad).
//     This is not always possible or feasible.
//
//   1) ContextReplacementPlugin - the most confusing (https://iamakulov.com/notes/webpack-contextreplacementplugin/)
//
//     This is used when the target module does exist but webpack can't determine a static path at compile time because
//     it contains an expression (e.g. require(`./languages/${lang}`)).
//
//   2) StringReplacePlugin (https://github.com/jamesandersen/string-replace-webpack-plugin)
//
//     Allows you to do regex replacement of the source code make it webpack-friendly before webpack processes the file
//
//   3) ExternalNodeModules
//
//     Add a Node.js module name to the externalModules variable in order to have the entire module excluded from being bundled.
//     It will instead be copied to ./dist/node_modules and picked up there through normal Node.js import/require mechanisms. Since
//     it will not be processed by webpack and has no access to webpack's set of bundled modules, all dependencies of this module
//     also have to be (automatically) excluded, so use sparingly.

'use strict';

const path = require('path');
const process = require('process');
const webpack = require('webpack');
const fse = require('fs-extra');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const StringReplacePlugin = require("string-replace-webpack-plugin");

const packageLock = fse.readJSONSync('./package-lock.json');

let DEBUG_WEBPACK = !!process.env.DEBUG_WEBPACK;

const externalNodeModules = [
    // Modules that we can't webpack for some reason.
    // Keep this list small, because all the subdependencies will also have to not be webpacked.

    // has binary
    //'clipboardy',

    // has binary
    //'win-ca'
];

// External modules and all their dependencies and subdependencies (these will not be webpacked)
const externalModulesClosure = getDependencies(externalNodeModules);
if (DEBUG_WEBPACK) {
    console.log('externalModulesClosure:', externalModulesClosure);
}

/**@type {import('webpack').Configuration}*/
const config = {
    // vscode extensions run in a Node.js context, see https://webpack.js.org/configuration/node/
    target: 'node',
    context: __dirname,
    node: {
        // For __dirname and __filename, use the path to the packed extension.js file (true would mean the relative path to the source file)
        __dirname: false,
        __filename: false
    },
    entry: {
        // Note: Each entry is a completely separate Node.js application that cannot interact with any
        // of the others, and that individually includes all dependencies necessary (i.e. common
        // dependencies will have a copy in each entry file, no sharing).

        // The entrypoint of this extension, see https://webpack.js.org/configuration/entry-context/
        extension: './src/extension.ts'
    },
    output: {
        // The bundles are stored in the 'dist' folder (check package.json), see https://webpack.js.org/configuration/output/
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]",
        sourcePrefix: "\tasdf\t", // string
        // prefix module sources in bundle for better readablitity     asdf
    },
    devtool: 'source-map',
    externals: [
        {
            // Modules that cannot be webpack'ed, see https://webpack.js.org/configuration/externals/

            // the vscode-module is created on-the-fly and must be excluded.
            vscode: 'commonjs vscode',

            // Fix "Module not found" errors in ./node_modules/websocket/lib/{BufferUtil,Validation}.js
            // These files are not in node_modules and so will fail normally at runtime and instead use fallbacks.
            // Make them as external so webpack doesn't try to process them, and they'll simply fail at runtime as before.
            '../build/Release/validation': 'commonjs ../build/Release/validation',
            '../build/default/validation': 'commonjs ../build/default/validation',
            '../build/Release/bufferutil': 'commonjs ../build/Release/bufferutil',
            '../build/default/bufferutil': 'commonjs ../build/default/bufferutil',

            // Pull the rest automatically from externalModulesClosure
            ...getExternalsEntries()
        }
    ],
    plugins: [
        // Clean the dist folder before webpacking
        new CleanWebpackPlugin(
            ['dist'],
            {
                root: __dirname,
                verbose: true,
            }),

        // Copy files to dist folder where the runtime can find them
        new CopyWebpackPlugin([
            // Test files -> dist/test (skipped during packaging)
            { from: './out/test', to: 'test' }
        ]),

        // External node modules (can't be webpacked) -> dist/node_modules (where they can be found by extension.js)
        getExternalsCopyEntry(),

        // Replace vscode-languageserver/lib/files.js with a modified version that doesn't have webpack issues
        // new webpack.NormalModuleReplacementPlugin(
        //     /[/\\]vscode-languageserver[/\\]lib[/\\]files\.js/,
        //     require.resolve('./build/vscode-languageserver-files-stub.js')
        // ),

        // Fix error:
        // WARNING in ./node_modules/ms-rest/lib/serviceClient.js 441:19-43
        // Critical dependency: the request of a dependency is an expression
        //
        //   let data = require(packageJsonPath);
        //
        new webpack.ContextReplacementPlugin(
            // Whenever there is a dynamic require that webpack can't analyze at all (i.e. resourceRegExp=/^\./), ...
            /^\./,
            (context) => {
                // ... and the call was from within node_modules/ms-rest/lib...
                if (/node_modules[/\\]ms-rest[/\\]lib/.test(context.context)) {
                    /* CONSIDER: Figure out how to make this work properly.

                        // ... tell webpack that the call may be loading any of the package.json files from the 'node_modules/azure-arm*' folders
                        // so it will include those in the package to be available for lookup at runtime
                        context.request = path.resolve(__dirname, 'node_modules');
                        context.regExp = /azure-arm.*package\.json/;
                    */

                    // In the meantime, just ignore the error by telling webpack we've solved the critical dependency issue.
                    // The consequences of ignoring this error are that
                    //   the Azure SDKs (e.g. azure-arm-resource) don't get their info stamped into the user agent info for their calls.
                    for (const d of context.dependencies) {
                        if (d.critical) { d.critical = false; }
                    }
                }
            }),

        // An instance of the StringReplacePlugin plugin must be present for it to work (its use is configured in modules).
        //
        // StringReplacePlugin allows you to specific parts of a file by regexp replacement to get around webpack issues such as dynamic imports.
        // This is different from ContextReplacementPlugin, which is simply meant to help webpack find files referred to by a dynamic import (i.e. it
        //   assumes  they can be found by simply knowing the correct the path).
        new StringReplacePlugin()
    ],
    resolve: {
        // Support reading TypeScript and JavaScript files, see https://github.com/TypeStrong/ts-loader
        // These will be automatically transpiled while being placed into dist/extension.js
        extensions: ['.ts', '.js']
    },
    module: {
        //asdf noParse: /websocket[\\/]lib[\\/]Validation/,
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [{
                    // Note: the TS loader will transpile the .ts file directly during webpack, it doesn't use the out folder.
                    // CONSIDER: awesome-typescript-loader (faster?)
                    loader: 'ts-loader'
                }]
            },

            {
                test: /\.(png|jpg|gif|svg)$/,
                use: [
                    {
                        loader: 'file-loader',
                        options: {}
                    }
                ],
            },

            // Note: If you use`vscode-nls` to localize your extension than you likely also use`vscode-nls-dev` to create language bundles at build time.
            // To support webpack, a loader has been added to vscode-nls-dev .Add the section below to the`modules/rules` configuration.
            // {
            //     // vscode-nls-dev loader:
            //     // * rewrite nls-calls
            //     loader: 'vscode-nls-dev/lib/webpack-loader',
            //     options: {
            //         base: path.join(__dirname, 'src')
            //     }
            // }
        ]
    }
}

function getExternalsEntries() {
    let externals = {};
    for (let moduleName of externalModulesClosure) {
        // e.g.
        // '<clipboardy>': 'commonjs <clipboardy>',
        externals[moduleName] = `commonjs ${moduleName}`;
    }

    return externals;
}

function getExternalsCopyEntry() {
    // e.g.
    // new CopyWebpackPlugin([
    //     { from: './node_modules/clipboardy', to: 'node_modules/clipboardy' }
    //     ...
    // ])
    let patterns = [];
    for (let moduleName of externalModulesClosure) {
        patterns.push({
            from: `./node_modules/${moduleName}`,
            to: `node_modules/${moduleName}`
        });
    }

    return new CopyWebpackPlugin(patterns);
}

function getDependencies(modules) {
    let set = new Set();

    for (let module of modules) {
        set.add(module);
        let depEntry = packageLock.dependencies[module];
        if (!depEntry) {
            throw new Error(`Could not find package-lock entry for ${module}`);
        }

        if (depEntry.requires) {
            let requiredModules = Object.getOwnPropertyNames(depEntry.requires);
            let subdeps = getDependencies(requiredModules);
            for (let subdep of subdeps) {
                set.add(subdep);
            }
        }
    }

    return Array.from(set);
}

if (DEBUG_WEBPACK) {
    console.log('Config:', config);
}
module.exports = config;
