import _ from 'lodash';
import {
  CocoonDefinitions,
  NodeDefinition,
  parsePortDefinition,
} from './definitions';

export const debug = require('debug')('cocoon:graph');

export interface CocoonNode extends NodeDefinition {
  definition: NodeDefinition;
  type: string;
  group: string;
  edgesIn: CocoonEdge[];
  edgesOut: CocoonEdge[];
  status: NodeStatus;
  cache?: NodeCache;
  summary?: string;
  error?: Error;
  viewData?: any;
}

export interface CocoonEdge {
  from: CocoonNode;
  fromPort: string;
  to: CocoonNode;
  toPort: string;
}

export interface NodeCache {
  summary: string;
  ports: { [outPort: string]: any };
}

export type Graph = CocoonNode[];

export enum NodeStatus {
  'unprocessed',
  'processing',
  'cached',
  'error',
}

export function createGraph(definitions: CocoonDefinitions): CocoonNode[] {
  debug(`creating graph nodes & edges from definitions`);

  // Create a flat list of nodes
  const groups = Object.keys(definitions);
  const nodes: CocoonNode[] = _.flatten(
    groups.map(group => {
      return definitions[group].nodes.map(node => {
        const type = Object.keys(node)[0];
        const definition = node[type];
        return _.assign(
          {
            definition,
            edgesIn: [] as CocoonEdge[],
            edgesOut: [] as CocoonEdge[],
            group,
            status: NodeStatus.unprocessed,
            type,
          },
          definition
        );
      });
    })
  );

  // Map all nodes
  const nodeMap = nodes.reduce((all, node) => {
    all[node.id] = node;
    return all;
  }, {});

  // Assign edges to nodes
  nodes.forEach(node => {
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

  return nodes;
}

export function findNode(graph: Graph, nodeId: string) {
  const node = graph.find(n => n.id === nodeId);
  if (node === undefined) {
    throw new Error(`no node in graph with the id "${nodeId}"`);
  }
  return node;
}

export function findPath(node: CocoonNode) {
  const path = resolveUpstream(node);
  return _.uniqBy(path, 'definition.id');
}

export function shortenPathUsingCache(path: CocoonNode[]) {
  return _.takeRightWhile(path, node => node.cache === undefined);
}

export function resolveUpstream(node: CocoonNode): Graph {
  return _.concat([], ...node.edgesIn.map(edge => resolveUpstream(edge.from)), [
    node,
  ]);
}

export function resolveDownstream(node: CocoonNode): Graph {
  return _.concat(
    [node],
    ...node.edgesOut.map(edge => resolveDownstream(edge.to))
  );
}
