import _ from 'lodash';
import {
  CocoonDefinitions,
  getNodesFromDefinitions,
  NodeDefinition,
  parsePortDefinition,
} from '../common/definitions';
import { CocoonEdge, CocoonNode, NodeStatus } from '../common/node';

const debug = require('../common/debug')('core:graph');

export type Graph = CocoonNode[];

const randomId = () =>
  Math.random()
    .toString(36)
    .substring(2, 7);

const createNodeFromDefinition = (
  type: string,
  group: string,
  definition: NodeDefinition
): CocoonNode =>
  _.assign(
    {
      edgesIn: [] as CocoonEdge[],
      edgesOut: [] as CocoonEdge[],
      group,
      status: NodeStatus.unprocessed,
      type,
    },
    { definition },
    // Definitions redundantly exist directly in the node object for two
    // reasons: more convenient access (`node.id` vs `node.definition.id`)
    // and temporary changes (assigning col/row for layouting) vs persisted
    // changes (changing the position in the definitions file)
    definition
  );

export function createGraph(definitions: CocoonDefinitions): Graph {
  debug(`creating graph nodes & edges from definitions`);

  // Create a flat list of nodes
  const graph: Graph = getNodesFromDefinitions(definitions).map(
    ({ definition, group, type }) =>
      createNodeFromDefinition(type, group, definition)
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

export function tryFindNode(graph: Graph, nodeId: string) {
  // TODO: memoize this function
  return graph.find(n => n.id === nodeId);
}

export function findNode(graph: Graph, nodeId: string) {
  const node = tryFindNode(graph, nodeId);
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

export function createUniqueNodeId(graph: Graph, prefix: string) {
  while (true) {
    const id = `${prefix}_${randomId()}`;
    // Make sure there are no collisions
    if (!tryFindNode(graph, id)) {
      return id;
    }
  }
}
