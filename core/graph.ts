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
  cache: NodeCache | null;
  status: NodeStatus;
  summary: string | null;
  error: Error | null;
  renderingData: object | null;
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
            cache: null,
            definition,
            edgesIn: [] as CocoonEdge[],
            edgesOut: [] as CocoonEdge[],
            error: null,
            group,
            renderingData: null,
            status: NodeStatus.unprocessed,
            summary: null,
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

export function findPath(graph: CocoonNode[], targetId: string) {
  const targetNode = graph.find(node => node.id === targetId);
  if (targetNode === undefined) {
    throw new Error(`no node in graph with the id "${targetId}"`);
  }
  return _.uniqBy(resolveNodeRequirements(targetNode), 'definition.id');
}

function resolveNodeRequirements(node: CocoonNode): CocoonNode[] {
  return _.concat(
    [],
    ...node.edgesIn.map(edge => resolveNodeRequirements(edge.from)),
    [node]
  );
}
