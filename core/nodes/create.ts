import * as nodes from '.';

export function createNodeInstance(type: string) {
  const nodeClass = nodes[type];
  if (!nodeClass) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return new nodeClass() as nodes.ICocoonNode<any>;
}
