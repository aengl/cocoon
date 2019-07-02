import {
  CocoonFile,
  CocoonNodeDefinition,
  GridPosition,
  PortInfo,
} from '@cocoon/types';
import _ from 'lodash';

export function updateNodeDefinition(
  definitions: CocoonFile,
  nodeId: string,
  nodeDefinition: CocoonNodeDefinition
) {
  if (nodeId in definitions.nodes) {
    definitions.nodes[nodeId] = nodeDefinition;
  }
}

export function createNodeDefinition(
  definitions: CocoonFile,
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

export function removeNodeDefinition(definitions: CocoonFile, nodeId: string) {
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
  const newDefinition =
    previousDefinition === undefined
      ? uri
      : _.uniq([..._.castArray(previousDefinition), uri]);
  node.in[port] =
    _.isArray(newDefinition) && newDefinition.length === 1
      ? newDefinition[0]
      : newDefinition;
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
