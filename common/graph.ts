import _ from 'lodash';
import {
  CocoonDefinitions,
  getNodesFromDefinitions,
  NodeDefinition,
  parsePortDefinition,
} from './definitions';
import { CocoonEdge, CocoonNode, NodeStatus } from './node';

const debug = require('debug')('common:graph');

export interface Graph {
  nodes: CocoonNode[];
  map: Map<string, CocoonNode>;
}

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
      edgesIn: [],
      edgesOut: [],
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

export function createGraphFromDefinitions(
  definitions: CocoonDefinitions
): Graph {
  debug(`creating graph nodes & edges from definitions`);
  const nodes = getNodesFromDefinitions(definitions).map(
    ({ definition, group, type }) =>
      createNodeFromDefinition(type, group, definition)
  );
  return createGraphFromNodes(nodes);
}

export function createGraphFromNodes(nodes: CocoonNode[]) {
  const graph: Graph = {
    map: new Map(),
    nodes: nodes.map(({ definition, group, type }) =>
      createNodeFromDefinition(type, group, definition)
    ),
  };
  graph.nodes.forEach(node => graph.map.set(node.id, node));
  createEdges(graph);
  return graph;
}

export function tryFindNode(graph: Graph, nodeId: string) {
  return graph.map.get(nodeId);
}

export function findNode(graph: Graph, nodeId: string) {
  const node = graph.map.get(nodeId);
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
): CocoonNode[] {
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
): CocoonNode[] {
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

function createEdges(graph: Graph) {
  // Assign edges to nodes
  graph.nodes.forEach(node => {
    if (node.in !== undefined) {
      // Assign incoming edges to the node
      node.edgesIn = Object.keys(node.in)
        .map(key => {
          const result = parsePortDefinition(node.in![key]);
          if (!result) {
            return null;
          }
          const { id, port } = result;
          if (graph.map.get(id) === undefined) {
            throw Error(
              `${node.id}: unknown node "${id}" in definition "${
                node.in![key]
              }"`
            );
          }
          return {
            from: graph.map.get(id),
            fromPort: port,
            to: node,
            toPort: key,
          };
        })
        .filter(x => x !== null) as CocoonEdge[];

      // Find nodes that the edges connect and assign as outgoing edge
      node.edgesOut = [];
      node.edgesIn.forEach(edge => {
        edge.from.edgesOut.push(edge);
      });
    }
  });
}
