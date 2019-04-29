import Debug from 'debug';
import path from 'path';
import { initialise, openDefinitions, processNodeById } from '../core';
import { Graph } from '../common/graph';

Debug.enable('core:*,common:*');

export async function testDefinition(definitionPath: string, nodeId: string) {
  await initialise();
  await openDefinitions(path.resolve(__dirname, definitionPath));
  const graph = await processNodeById(nodeId);
  return reduceToStates(graph);
}

async function reduceToStates(graph: Graph) {
  return graph.nodes.reduce((all, node) => {
    all[node.id] = node.state;
    return all;
  }, {});
}
