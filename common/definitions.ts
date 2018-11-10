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
  id: string;
  description?: string;
  config?: any;
  col?: number;
  row?: number;
  in?: PortDefinitions;
}

export interface CocoonDefinitions {
  description?: string;
  nodes: Array<{ [nodeType: string]: NodeDefinition }>;
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
  return _.flatten(
    definitions.nodes.map(node => {
      const type = Object.keys(node)[0];
      return {
        definition: node[type],
        type,
      };
    })
  );
}

export function updateNodesInDefinitions(
  definitions: CocoonDefinitions,
  resolveDefinition: (nodeId: string) => NodeDefinition | undefined
) {
  definitions.nodes.map(node => {
    const type = Object.keys(node)[0];
    const nodeObj = node[type];
    const definition = resolveDefinition(nodeObj.id);
    if (definition) {
      node[type] = definition;
    }
  });
}

export function diffDefinitions(
  definitionsA: CocoonDefinitions,
  definitionsB: CocoonDefinitions
) {
  const nodesA = getNodesFromDefinitions(definitionsA).reduce((all, node) => {
    all[node.definition.id] = node;
    return all;
  }, {});
  const nodesB = getNodesFromDefinitions(definitionsB).reduce((all, node) => {
    all[node.definition.id] = node;
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
  row?: number,
  connections?: {
    [port: string]: { id: string; port: string };
  }
) {
  const node: NodeDefinition = { id: nodeId };
  definitions.nodes.push({
    [nodeType]: node,
  });
  if (col !== undefined) {
    node.col = col;
  }
  if (row !== undefined) {
    node.row = row;
  }
  if (connections !== undefined) {
    node.in = Object.keys(connections).reduce((all, x) => {
      const { id, port } = connections[x];
      all[x] = `${id}/${port}`;
      return all;
    }, {});
  }
  return node;
}

export function removeNodeDefinition(
  definitions: CocoonDefinitions,
  nodeId: string
) {
  definitions.nodes = definitions.nodes.filter(
    n => n[Object.keys(n)[0]].id !== nodeId
  );
}
