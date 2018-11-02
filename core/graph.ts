import _ from 'lodash';
import {
  CocoonDefinitions,
  getNodesFromDefinitions,
  parsePortDefinition,
} from '../common/definitions';
import { CocoonEdge, CocoonNode, NodeStatus } from '../common/node';

const debug = require('../common/debug')('core:graph');

export type Graph = CocoonNode[];

export function createGraph(definitions: CocoonDefinitions): Graph {
  debug(`creating graph nodes & edges from definitions`);

  // Create a flat list of nodes
  const graph: Graph = getNodesFromDefinitions(definitions).map(
    ({ definition, group, type }) =>
      _.assign(
        {
          definition,
          edgesIn: [] as CocoonEdge[],
          edgesOut: [] as CocoonEdge[],
          group,
          status: NodeStatus.unprocessed,
          type,
        },
        definition
      )
  );

  // Map all nodes
  const nodeMap = graph.reduce((all, node) => {
    all[node.id] = node;
    return all;
  }, {});

  // Assign edges to nodes
  graph.forEach(node => {
    if (node.in !== undefined) {
      // Assign incoming edges to the node
      node.edgesIn = Object.keys(node.in)
        .map(key => {
          const result = parsePortDefinition(node.in![key]);
          if (!result) {
            return null;
          }
          const { id, port } = result;
          if (nodeMap[id] === undefined) {
            throw Error(
              `${node.id}: unknown node "${id}" in definition "${
                node.in![key]
              }"`
            );
          }
          return {
            from: nodeMap[id],
            fromPort: port,
            to: node,
            toPort: key,
          };
        })
        .filter(x => x !== null) as CocoonEdge[];

      // Find nodes that the edges connect and assign as outgoing edge
      node.edgesIn.forEach(edge => {
        edge.from.edgesOut.push(edge);
      });
    }
  });

  return graph;
}

export function findNode(graph: Graph, nodeId: string) {
  const node = graph.find(n => n.id === nodeId);
  if (node === undefined) {
    throw new Error(`no node in graph with the id "${nodeId}"`);
  }
  return node;
}

export function findPath(node: CocoonNode) {
  const path = resolveUpstream(node, n => n.cache === undefined);
  return _.uniqBy(path, 'definition.id');
}

export function resolveUpstream(
  node: CocoonNode,
  predicate?: (node: CocoonNode) => boolean
): Graph {
  if (predicate && !predicate(node)) {
    return [];
  }
  return _.concat(
    [],
    ...node.edgesIn.map(edge => resolveUpstream(edge.from, predicate)),
    [node]
  );
}

export function resolveDownstream(
  node: CocoonNode,
  predicate?: (node: CocoonNode) => boolean
): Graph {
  if (predicate && !predicate(node)) {
    return [];
  }
  return _.concat(
    [node],
    ...node.edgesOut.map(edge => resolveDownstream(edge.to, predicate))
  );
}
