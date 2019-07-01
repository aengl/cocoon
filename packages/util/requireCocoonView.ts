import { CocoonRegistry, CocoonView } from '@cocoon/types';

export default function(registry: CocoonRegistry, type: string): CocoonView {
  const view = registry.views[type];
  if (!view) {
    throw new Error(`view type does not exist: ${type}`);
  }
  return view;
}
