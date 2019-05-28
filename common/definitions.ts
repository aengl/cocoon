import yaml from 'js-yaml';
import _ from 'lodash';
import { PortInfo } from './graph';
import { GridPosition } from './math';

export interface CocoonNodeActions {
  [actionName: string]: string;
}

export interface CocoonNodeDefinition<ViewStateType = any> {
  '?'?: string;
  description?: string;
  editor?: {
    actions?: CocoonNodeActions;
    col?: number;
    row?: number;
  };
  in?: { [id: string]: any };
  persist?: boolean;
  type: string;
  view?: string;
  viewState?: ViewStateType;
}

export interface CocoonDefinitions {
  description?: string;
  nodes: { [nodeId: string]: CocoonNodeDefinition };
}

export interface CocoonDefinitionsInfo {
  parsed?: CocoonDefinitions;
  path: string;
  raw: string;
  root: string;
}

export function parseCocoonDefinitions(definitions: string) {
  return yaml.load(definitions) as CocoonDefinitions;
}

export function parsePortDefinition(
  portDefinition: any
): { id: string; port: PortInfo } | undefined {
  if (_.isString(portDefinition)) {
    const match = portDefinition.match(
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
  viewDefinition: string
): { type: string; port: PortInfo } | undefined {
  const match = viewDefinition.match(
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
  resolveDefinition: (nodeId: string) => CocoonNodeDefinition | undefined
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
  position?: GridPosition
) {
  const node: CocoonNodeDefinition = {
    editor: {},
    type: nodeType,
  };
  definitions.nodes[nodeId] = node;
  if (position) {
    node.editor!.col = position.col;
    node.editor!.row = position.row;
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
  node: CocoonNodeDefinition,
  port: string,
  fromNodeId: string,
  fromNodePort: string
) {
  if (node.in === undefined) {
    node.in = {};
  }
  const uri = `cocoon://${fromNodeId}/out/${fromNodePort}`;
  const previousDefinition = node.in[port];
  node.in[port] =
    previousDefinition === undefined
      ? uri
      : [..._.castArray(previousDefinition), uri];
}

export function removePortDefinition(node: CocoonNodeDefinition, port: string) {
  if (node.in === undefined) {
    throw new Error();
  }
  delete node.in[port];
}

export function assignViewDefinition(
  node: CocoonNodeDefinition,
  type: string,
  port?: PortInfo
) {
  node.view =
    port === undefined
      ? type
      : `${port.incoming ? 'in' : 'out'}/${port.name}/${type}`;
  delete node.viewState;
}

export function removeViewDefinition(node: CocoonNodeDefinition) {
  delete node.view;
  delete node.viewState;
}

export function positionIsEqual(
  nodeA: CocoonNodeDefinition,
  nodeB: CocoonNodeDefinition
) {
  if (!nodeA.editor || !nodeB.editor) {
    return nodeA.editor === nodeB.editor;
  }
  return (
    nodeA.editor.col === nodeB.editor.col &&
    nodeA.editor.row === nodeB.editor.row
  );
}
