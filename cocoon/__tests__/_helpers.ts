import { initialise, openDefinitions, processNodeById } from '../src/index';
import { Graph } from '@cocoon/types';
import Debug from 'debug';

const path = require('path');

Debug.enable('cocoon:*,shared:*');

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
