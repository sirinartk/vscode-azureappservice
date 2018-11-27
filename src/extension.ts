/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is the entrypoint for extension.js, the main webpack bundle for the extension.
 * Anything needing to be exposed outside of the extension sources must be exported from here, because
 * everything else will be in private modules in extension.js.
 */

// Export activate for vscode to call (via entrypoint.js)
export { activate } from './appServiceExtension';

// Exports for use by the tests, which are not packaged with the webpack bundle and therefore
//   only have access to code exported from this file. The tests should import '../extension.ts' (this file),
//   to access these exports, and at runtime they will pick up dist/extension.js.
