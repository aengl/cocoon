import { CocoonNode, CocoonRegistry } from '@cocoon/types';

export default function(registry: CocoonRegistry, type: string): CocoonNode {
  const node = registry.nodes[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}
