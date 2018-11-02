/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBConnection } from '../../explorer/CosmosDBConnection';
import { ext } from "../../extensionVariables";

export async function attachCosmosDBDatabase(node: CosmosDBConnection): Promise<void> {
    await node.attachToCosmos();
    await ext.tree.refresh(node.parent);
    await ext.cosmosAPI.revealTreeItem(node.cosmosDBDatabase.treeItemId);
}
