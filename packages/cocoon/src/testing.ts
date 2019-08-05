import { Graph } from '@cocoon/types';
import Debug from 'debug';
import {
  initialise,
  openCocoonFile,
  processNodeById,
  processAllNodes,
} from './index';

export async function testDefinition(definitionPath: string, nodeId?: string) {
  Debug.enable('cocoon:*');
  await initialise();
  await openCocoonFile(definitionPath);
  const graph = await (nodeId ? processNodeById(nodeId) : processAllNodes());
  return reduceToStates(graph);
}

async function reduceToStates(graph: Graph) {
  return graph.nodes.reduce((all, node) => {
    all[node.id] = node.state;
    return all;
  }, {});
}
