import { get, isNil, omitNil } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Verbatim port of legacy `@cocoon/cocoon` data/Join — lodash shed to
 * `../lodash-lite.ts` (`get`/`isNil`/`omitBy(_,isNil)`; `isArray` →
 * `Array.isArray`). The `new Map()` used via bracket access (i.e. as a plain
 * dictionary) is the legacy idiom and is preserved as-is so lookup behaviour
 * — including its `Map.prototype` key-collision surface — stays identical.
 */
export const Join: CocoonProcessNode = {
  category: 'Data',
  description: 'Joins two collections via a primary key.',

  async *process(context) {
    const { affluent, annotate, attribute, data, key, preserve } =
      context.ports.read() as {
        affluent: Record<string, unknown>[];
        annotate?: Record<string, unknown>;
        attribute?: string;
        data: Record<string, unknown>[];
        key: string | [string, string];
        preserve?: boolean;
      };
    const affluentKey = Array.isArray(key) ? key[1] : key;
    const dataKey = Array.isArray(key) ? key[0] : key;
    const shallowDataCopy = [...data];
    const matched: Record<string, unknown>[] = [];
    const unmatched: Record<string, unknown>[] = [];

    // Create lookup map for affluent data
    const affluentLookup = new Map<string, Record<string, unknown>>();
    const lookupAsDict = affluentLookup as unknown as Record<string, unknown>;
    affluent.forEach(x => {
      const v = get(x, affluentKey) as string;
      if (v) {
        lookupAsDict[v] = x;
      }
    });

    // Join data
    let numJoined = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 1000 === 0) {
        yield [`Found ${numJoined} matches`, i / data.length];
      }
      const dataKeyValue = get(data[i], dataKey) as string | undefined;
      if (isNil(dataKeyValue)) {
        unmatched.push(data[i]);
        continue;
      }
      const affluentKeyValue = lookupAsDict[dataKeyValue] as
        | Record<string, unknown>
        | undefined;
      if (isNil(affluentKeyValue)) {
        unmatched.push(data[i]);
        continue;
      }
      const affluentData = omitNil(
        attribute ? { [attribute]: affluentKeyValue } : affluentKeyValue
      );
      if (preserve) {
        shallowDataCopy[i] = {
          ...affluentData,
          ...data[i],
          ...annotate,
        };
      } else {
        shallowDataCopy[i] = {
          ...data[i],
          ...affluentData,
          ...annotate,
        };
      }
      numJoined += 1;
      matched.push(data[i]);
    }

    context.ports.write({
      data: shallowDataCopy,
      matched,
      unmatched,
    });
    return `Found ${numJoined} matches`;
  },
};
