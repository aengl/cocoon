import type { CocoonProcessNode } from '../../core/contract.ts';

type Row = Record<string, unknown>;

/**
 * Left join: each `data` row is shallow-merged with the `affluent` row that
 * shares its `key` value; unmatched rows pass through unchanged. Shared by
 * the sandbox flows via `nodeDirs: [../shared-nodes]`.
 */
export const Join: CocoonProcessNode = {
  category: 'Data',
  description: 'Merges rows from `affluent` into `data` by a shared key.',

  async *process(ctx) {
    const { data, affluent, key } = ctx.ports.read() as {
      data: Row[];
      affluent: Row[];
      key: string;
    };
    const byKey = new Map(affluent.map(row => [row[key], row]));
    let matched = 0;
    const joined = data.map(row => {
      const other = byKey.get(row[key]);
      if (!other) return row;
      matched += 1;
      return { ...row, ...other };
    });

    ctx.ports.write({ data: joined });
    return `Joined ${matched} of ${data.length} items`;
  },
};
