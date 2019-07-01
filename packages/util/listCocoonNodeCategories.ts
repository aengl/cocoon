import { CocoonRegistry } from '@cocoon/types';
import listCocoonNodes from './listCocoonNodes';

export default function(registry: CocoonRegistry): Array<string | undefined> {
  return [
    ...new Set(
      listCocoonNodes(registry).map(n => (n ? n.value.category : undefined))
    ).values(),
  ].sort();
}
