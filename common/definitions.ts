import yaml from 'js-yaml';
import _ from 'lodash';
import { PortInfo } from './graph';

export interface NodeDefinition {
  col?: number;
  description?: string;
  in?: { [id: string]: any };
  row?: number;
  type: string;
  view?: string;
  viewState?: any;
}

export interface CocoonDefinitions {
  description?: string;
  nodes: { [nodeId: string]: NodeDefinition };
}

export function parseCocoonDefinitions(definitions: string) {
  return yaml.load(definitions) as CocoonDefinitions;
}

export function parsePortDefinition(
  definition: any
): { id: string; port: PortInfo } | undefined {
  if (_.isString(definition)) {
    const match = definition.match(
      /cocoon:\/\/(?<id>[^\/]+)\/(?<inout>[^\/]+)\/(?<port>.+)/
    );
    if (match !== null && match.groups !== undefined) {
      return {
        id: match.groups.id,
        port: {
          incoming: match.groups.inout === 'in',
          name: match.groups.port,
        },
      };
    }
  }
  return;
}

export function parseViewDefinition(
  definition: string
): { type: string; port: PortInfo } | undefined {
  const match = definition.match(
    /(?<inout>[^\/]+)\/(?<port>[^\/]+)\/(?<type>.+)/
  );
  return match === null || match.groups === undefined
    ? undefined
    : {
        port: {
          incoming: match.groups.inout === 'in',
          name: match.groups.port,
        },
        type: match.groups.type,
      };
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
  node.in[port] = `cocoon://${fromNodeId}/out/${fromNodePort}`;
}

export function removePortDefinition(node: NodeDefinition, port: string) {
  if (node.in === undefined) {
    throw new Error();
  }
  delete node.in[port];
}

export function assignViewDefinition(
  node: NodeDefinition,
  type: string,
  port?: PortInfo
) {
  node.view =
    port === undefined
      ? type
      : `${port.incoming ? 'in' : 'out'}/${port.name}/${type}`;
}

export function removeViewDefinition(node: NodeDefinition) {
  delete node.view;
}

export function assignViewState(node: NodeDefinition, viewState: any) {
  node.viewState = viewState;
}
