import yaml from 'js-yaml';
import _ from 'lodash';

const debug = require('debug')('common:definitions');

export interface ImportDefinition {
  import: string;
}

export interface PortDefinitions {
  [id: string]: any;
}

export interface NodeDefinition {
  type: string;
  description?: string;
  config?: any;
  col?: number;
  row?: number;
  in?: PortDefinitions;
}

export interface CocoonDefinitions {
  description?: string;
  nodes: { [nodeId: string]: NodeDefinition };
}

export function parseCocoonDefinitions(definitions: string) {
  return yaml.load(definitions) as CocoonDefinitions;
}

export function parsePortDefinition(definition: string) {
  const match = definition.match(/(?<id>[^/]+)\/(?<port>.+)/);
  if (!match || match.groups === undefined) {
    return null;
  }
  return { id: match.groups.id, port: match.groups.port };
}

export function getNodesFromDefinitions(definitions: CocoonDefinitions) {
  return Object.keys(definitions.nodes).map(id => ({
    definition: definitions.nodes[id],
    id,
  }));
}

export function updateNodesInDefinitions(
  definitions: CocoonDefinitions,
  resolveDefinition: (nodeId: string) => NodeDefinition | undefined
) {
  Object.keys(definitions.nodes).forEach(nodeId => {
    const definition = resolveDefinition(nodeId);
    if (definition) {
      definitions.nodes[nodeId] = definition;
    }
  });
}

export function diffDefinitions(
  definitionsA: CocoonDefinitions,
  definitionsB: CocoonDefinitions
) {
  const nodesA = getNodesFromDefinitions(definitionsA).reduce((all, node) => {
    all[node.id] = node;
    return all;
  }, {});
  const nodesB = getNodesFromDefinitions(definitionsB).reduce((all, node) => {
    all[node.id] = node;
    return all;
  }, {});
  return {
    addedNodes: Object.keys(nodesB).filter(id => nodesA[id] === undefined),
    changedNodes: Object.keys(nodesA)
      .filter(id => nodesB[id] !== undefined)
      .filter(id => !_.isEqual(nodesA[id], nodesB[id])),
    removedNodes: Object.keys(nodesA).filter(id => nodesB[id] === undefined),
  };
}

export function createNodeDefinition(
  definitions: CocoonDefinitions,
  nodeType: string,
  nodeId: string,
  col?: number,
  row?: number
) {
  const node: NodeDefinition = { type: nodeType };
  definitions.nodes[nodeId] = node;
  if (col !== undefined) {
    node.col = col;
  }
  if (row !== undefined) {
    node.row = row;
  }
  return node;
}

export function removeNodeDefinition(
  definitions: CocoonDefinitions,
  nodeId: string
) {
  delete definitions.nodes[nodeId];
}

export function assignPortDefinition(
  node: NodeDefinition,
  port: string,
  fromNodeId: string,
  fromNodePort: string
) {
  if (node.in === undefined) {
    node.in = {};
  }
  node.in[port] = `${fromNodeId}/${fromNodePort}`;
}

export function removePortDefinition(node: NodeDefinition, port: string) {
  if (node.in === undefined) {
    throw new Error();
  }
  delete node.in[port];
}
