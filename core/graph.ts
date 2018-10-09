import _ from 'lodash';
import {
  CocoonDefinitions,
  NodeDefinition,
  parsePortDefinition,
} from './definitions';

export const debug = require('debug')('cocoon:graph');

export interface CocoonNode {
  definition: NodeDefinition;
  type: string;
  group: string;
  edges: CocoonEdge[];
}

export interface CocoonEdge {
  from: CocoonNode;
  fromPort: string;
  to: CocoonNode;
  toPort: string;
}

export function createGraph(definitions: CocoonDefinitions): CocoonNode[] {
  debug(`creating graph nodes & edges from definitions`);
  // Create a flat list of nodes
  const groups = Object.keys(definitions);
  const nodes = _.flatten(
    groups.map(group => {
      return definitions[group].nodes.map(node => {
        const type = Object.keys(node)[0];
        return {
          definition: node[type],
          edges: [] as CocoonEdge[],
          group,
          type,
        };
      });
    })
  );
  // Map all nodes
  const nodeMap = nodes.reduce((all, node) => {
    all[node.definition.id] = node;
    return all;
  }, {});
  // Assign edges to nodes
  nodes.forEach(node => {
    const nodeOut = node.definition.out;
    if (nodeOut !== undefined) {
      node.edges = Object.keys(nodeOut).map(key => {
        const { id, port } = parsePortDefinition(nodeOut[key]);
        return {
          from: node,
          fromPort: key,
          to: nodeMap[id],
          toPort: port,
        };
      });
    }
  });
  debug(nodes);
  return nodes;
}
