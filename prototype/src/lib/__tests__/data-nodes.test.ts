/**
 * Locks the ported legacy `@cocoon/cocoon` data nodes to their original
 * behaviour. The `Sort` cases are the exact expectations from legacy
 * `packages/cocoon/src/nodes/data/Sort.test.ts.md` (AVA snapshots) — ranking
 * order is the whole point of the Tibi flows, so this guards against the
 * lodash → `lodash-lite` port drifting. `Join`/`Deduplicate` cover the
 * key-merge and last-wins-dedup semantics the boardgames flow relies on.
 */
import { describe, expect, it } from 'vitest';
import type { CocoonProcessNode } from '../../../core/contract.ts';
import { Sort } from '../../../core/nodes/Sort.ts';
import { Join } from '../../../core/nodes/Join.ts';
import { Deduplicate } from '../../../core/nodes/Deduplicate.ts';

/** Drive a node's process generator to completion, capturing written ports. */
async function run(
  node: CocoonProcessNode,
  ports: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let written: Record<string, unknown> = {};
  const ctx = {
    ports: {
      read: () => ports,
      write: (d: Record<string, unknown>) => (written = d),
    },
    controls: { read: () => ({}) },
    debug: () => {},
    cocoonFilePath: '/tmp/cocoon.yml',
    nodeId: 'test',
  };
  const gen = node.process(ctx);
  while (!(await gen.next()).done) {
    /* drain progress */
  }
  return written;
}

describe('Sort (legacy snapshot parity)', () => {
  it('partitions unsortable data', async () => {
    const out = await run(Sort, {
      data: [{ a: 2 }, { a: 1 }, { b: 1 }],
      orderBy: 'a',
    });
    expect(out).toEqual({
      data: [{ a: 1 }, { a: 2 }],
      unsortable: [{ b: 1 }],
    });
  });

  it('sorts ascending by default', async () => {
    const out = await run(Sort, { data: [{ a: 2 }, { a: 1 }], orderBy: 'a' });
    expect(out).toEqual({ data: [{ a: 1 }, { a: 2 }], unsortable: [] });
  });

  it('sorts descending', async () => {
    const out = await run(Sort, {
      data: [{ a: 2 }, { a: 1 }],
      orderBy: 'a',
      orders: ['desc'],
    });
    expect(out).toEqual({ data: [{ a: 2 }, { a: 1 }], unsortable: [] });
  });

  it('multi-key mixed asc/desc, stable', async () => {
    const out = await run(Sort, {
      data: [
        { a: 2, b: 1 },
        { a: 1, b: 2 },
        { a: 1, b: 1 },
      ],
      orderBy: ['a', 'b'],
      orders: ['asc', 'desc'],
    });
    expect(out).toEqual({
      data: [
        { a: 1, b: 2 },
        { a: 1, b: 1 },
        { a: 2, b: 1 },
      ],
      unsortable: [],
    });
  });
});

describe('Join', () => {
  it('merges affluent into data on key, default order', async () => {
    const out = await run(Join, {
      data: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3 }],
      affluent: [{ id: 1, extra: 'x' }, { id: 2, extra: 'y' }],
      key: 'id',
    });
    expect(out.data).toEqual([
      { id: 1, name: 'a', extra: 'x' },
      { id: 2, name: 'b', extra: 'y' },
      { id: 3 },
    ]);
    expect(out.unmatched).toEqual([{ id: 3 }]);
  });

  it('preserve keeps the original data values on collision', async () => {
    const out = await run(Join, {
      data: [{ id: 1, v: 'data' }],
      affluent: [{ id: 1, v: 'affluent', extra: 1 }],
      key: 'id',
      preserve: true,
    });
    expect(out.data).toEqual([{ id: 1, v: 'data', extra: 1 }]);
  });
});

describe('Deduplicate', () => {
  it('default pick keeps the later occurrence', async () => {
    const out = await run(Deduplicate, {
      data: [
        { asin: 'A', n: 1 },
        { asin: 'B', n: 2 },
        { asin: 'A', n: 3 },
      ],
      attribute: 'asin',
    });
    expect(out.data).toEqual([
      { asin: 'A', n: 3 },
      { asin: 'B', n: 2 },
    ]);
  });
});
