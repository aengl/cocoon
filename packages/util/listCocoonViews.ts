import { CocoonRegistry } from '@cocoon/types';

export default function(registry: CocoonRegistry) {
  return Object.keys(registry.views).map(type => ({
    type,
    value: registry.views[type]!,
  }));
}
