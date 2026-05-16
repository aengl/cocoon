import { castFunction } from '../cast-function.ts';
import { get } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

export type PickFunction = (
  item: Record<string, unknown>,
  existingItem: Record<string, unknown>
) => Record<string, unknown>;

const identity = <T>(x: T): T => x;

/**
 * Verbatim port of legacy `@cocoon/cocoon` data/Deduplicate — lodash shed to
 * `../lodash-lite.ts` (`get`) and a local `identity` (the legacy default
 * `pick`, which keeps the *later* occurrence). `castFunction` evaluates a
 * string `pick` exactly like legacy `@cocoon/util/castFunction`.
 */
export const Deduplicate: CocoonProcessNode = {
  category: 'Data',
  description: `Removes duplicates from a collection using a unique primary key attribute`,

  async *process(context) {
    const { attribute, data, pick } = context.ports.read() as {
      attribute: string;
      data: Record<string, unknown>[];
      pick?: string | PickFunction;
    };
    const [deduplicated, removed] = deduplicate(
      data,
      attribute,
      pick ? castFunction<PickFunction>(pick)! : identity
    );
    context.ports.write({
      data: deduplicated,
      removed,
    });
    return `Removed ${data.length - deduplicated.length} duplicates`;
  },
};

function deduplicate(
  data: Record<string, unknown>[],
  attribute: string,
  pick: PickFunction
): [Record<string, unknown>[], Record<string, unknown>[]] {
  const map = new Map();
  const removed: Record<string, unknown>[] = [];
  for (const item of data) {
    const key = get(item, attribute);
    const existingItem = map.get(key);
    if (existingItem) {
      const pickedItem = pick(item, existingItem);
      const pickedRemoved =
        pickedItem === item ? [item, existingItem] : [existingItem, item];
      removed.push({
        $duplicate: pickedRemoved[0],
        ...pickedRemoved[1],
      });
      map.set(key, pickedItem);
    } else {
      map.set(key, item);
    }
  }
  return [[...map.values()], removed];
}
