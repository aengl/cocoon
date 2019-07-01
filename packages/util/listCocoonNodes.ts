import { CocoonRegistry } from '@cocoon/types';

export default function(registry: CocoonRegistry) {
  return Object.keys(registry.nodes).map(type => ({
    type,
    value: registry.nodes[type]!,
  }));
}
