/**
 * Locks the ported legacy `@cocoon/plugin-distance` `Score` node + its metric
 * machinery to their original behaviour — the same bar as `Sort` in
 * `data-nodes.test.ts`. Scoring decides ranking order, which is the entire
 * point of the Tibi flows, so a drift in the lodash/d3/simple-statistics →
 * zero-dep ports must fail loudly here.
 *
 *  - `Score (legacy snapshot parity)` reproduces the three exact AVA
 *    snapshots from legacy `packages/plugins/distance/nodes/Score.test.ts.md`.
 *  - the per-metric blocks reproduce the explicit expectations from the
 *    legacy `metrics/<name>.test.ts` for every metric `boardgames.yml`
 *    actually uses (MAD/Linear/Test/Equal) plus IQR/Rank (which exercise the
 *    `scaleLinear`/`quantile`/`median` numeric ports hardest).
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CocoonProcessNode } from '../../../core/contract.ts';
import { Score } from '../../../core/nodes/Score.ts';
import { metrics } from '../../../core/metrics/index.ts';

const { MAD, Linear, Equal, Test, IQR, Rank } = metrics;
const noop = () => {};

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
    // Faithful to runtime `resolveFlowPath` (flow dir of /tmp/cocoon.yml);
    // these are pure transforms so it's never actually called.
    resolvePath: (...s: string[]) => path.resolve('/tmp', ...s),
    nodeId: 'test',
  };
  const gen = node.process(ctx);
  while (!(await gen.next()).done) {
    /* drain progress */
  }
  return written;
}

/** Legacy `Score.test.ts` `valuesToData`. */
function valuesToData(values: { [attr: string]: any[] }) {
  const keys = Object.keys(values);
  return values[keys[0]].map((_0, i) =>
    Object.keys(values).reduce((obj: any, key) => {
      obj[key] = values[key][i];
      return obj;
    }, {})
  );
}

const equalConfig = {
  score: { metrics: { a: { type: 'Equal' }, b: { type: 'Equal' } } },
};

describe('Score (legacy snapshot parity)', () => {
  it('scores correctly', async () => {
    const out = await run(Score, {
      attributes: equalConfig,
      data: valuesToData({ a: [5, 0, 10, -5], b: [5, 10, 0, 15] }),
    });
    expect(out.data).toEqual([
      { a: 5, b: 5, score: 10, $score: { a: 5, b: 5 } },
      { a: 0, b: 10, score: 10, $score: { a: 0, b: 10 } },
      { a: 10, b: 0, score: 10, $score: { a: 10, b: 0 } },
      { a: -5, b: 15, score: 10, $score: { a: -5, b: 15 } },
    ]);
    expect(out.scores).toEqual([
      { score: 10, score_a: 5, score_b: 5 },
      { score: 10, score_a: 0, score_b: 10 },
      { score: 10, score_a: 10, score_b: 0 },
      { score: 10, score_a: -5, score_b: 15 },
    ]);
  });

  it('handles nil values', async () => {
    const out = await run(Score, {
      attributes: equalConfig,
      data: valuesToData({
        a: [null, undefined, null, 42],
        b: [null, null, 23, undefined],
      }),
    });
    expect(out.data).toEqual([
      { a: null, b: null, score: 0, $score: { a: null, b: null } },
      { a: undefined, b: null, score: 0, $score: { a: null, b: null } },
      { a: null, b: 23, score: 23, $score: { a: null, b: 23 } },
      { a: 42, b: undefined, score: 42, $score: { a: 42, b: null } },
    ]);
    expect(out.scores).toEqual([
      { score: 0, score_a: null, score_b: null },
      { score: 0, score_a: null, score_b: null },
      { score: 23, score_a: null, score_b: 23 },
      { score: 42, score_a: 42, score_b: null },
    ]);
  });

  it('normalises correctly', async () => {
    const out = await run(Score, {
      attributes: {
        score: {
          metrics: { a: { type: 'Equal' }, b: { type: 'Equal' } },
          normalise: true,
        },
      },
      data: valuesToData({ a: [0, 2, 1, -2], b: [-5, 0.5, 4, 2] }),
    });
    expect(out.data).toEqual([
      { a: 0, b: -5, score: 0, $score: { a: 0, b: -5 } },
      { a: 2, b: 0.5, score: 0.75, $score: { a: 2, b: 0.5 } },
      { a: 1, b: 4, score: 1, $score: { a: 1, b: 4 } },
      { a: -2, b: 2, score: 0.5, $score: { a: -2, b: 2 } },
    ]);
    expect(out.scores).toEqual([
      { score: 0, score_a: 0, score_b: -5 },
      { score: 0.75, score_a: 2, score_b: 0.5 },
      { score: 1, score_a: 1, score_b: 4 },
      { score: 0.5, score_a: -2, score_b: 2 },
    ]);
  });
});

describe('MAD (legacy metric parity)', () => {
  const c = { attribute: '', iqr: false } as any;

  it('scores correctly around the median', () => {
    const cache = MAD.cache!(
      c,
      [0, 2, 3, 5, 21, 22, 22, 23, 24, 55, 100, 1000000],
      noop
    );
    expect(MAD.score(c, cache, 4)).toBe(-1);
    expect(MAD.score(c, cache, 22)).toBe(0);
    expect(MAD.score(c, cache, 40)).toBe(1);
    expect(MAD.score(c, cache, 58)).toBe(2);
  });

  it('handles null values', () => {
    const cache = MAD.cache!(
      c,
      [0, 2, 3, 5, 21, null, 22, 22, 23, null, undefined, 24, 55, 100, 1000000],
      noop
    );
    expect(MAD.score(c, cache, 4)).toBe(-1);
    expect(MAD.score(c, cache, 22)).toBe(0);
    expect(MAD.score(c, cache, 40)).toBe(1);
    expect(MAD.score(c, cache, 58)).toBe(2);
  });

  it('handles distributions without variance', () => {
    const config = { ...c, invert: true };
    const cache = MAD.cache!(config, [1, 1, 1, 1, 1], noop);
    expect(MAD.score(config, cache, 1)).toBeNull();
    expect(MAD.score(config, cache, 2)).toBeNull();
  });

  it('handles invalid values', () => {
    const cache = MAD.cache!(c, [1, 2, 23, 42], noop);
    expect(MAD.score(c, cache, 'foo' as any)).toBeNull();
    expect(MAD.score(c, cache, NaN)).toBeNull();
    expect(MAD.score(c, cache, [1, 2] as any)).toBeNull();
  });

  it('filters outliers using iqr', () => {
    const config = { ...c, iqr: true };
    const cache = MAD.cache!(
      config,
      [-1000000, 0, 2, 3, 5, 21, 22, 22, 23, 24, 55, 1000000],
      noop
    );
    expect(MAD.score(config, cache, -1000000)!).toBeGreaterThan(-3);
    expect(MAD.score(config, cache, 1000000)!).toBeLessThan(3);
  });
});

describe('Linear (legacy metric parity)', () => {
  const c = { attribute: '' } as any;
  it('scores a single value', () => {
    expect(Linear.score(c, null, 0)).toBe(0);
    expect(Linear.score({ ...c, value: 23 }, null, 42)).toBe(19);
  });
  it('calculates the distances between two values', () => {
    expect(Linear.distance(c, null, 0, 23)).toBe(-23);
    expect(Linear.distance(c, null, 42, -42)).toBe(84);
  });
});

describe('Equal (legacy metric parity)', () => {
  const c = { attribute: '', penalty: 10 } as any;
  it('acts as an identity for single values', () => {
    expect(Equal.score(c, null, 42)).toBe(42);
    expect(Equal.score(c, null, -23)).toBe(-23);
  });
  it('checks two values for equality', () => {
    expect(Equal.distance(c, null, 0, 0)).toBe(0);
    expect(Equal.distance(c, null, 1, 1)).toBe(0);
    expect(Equal.distance(c, null, 23, 42)).toBe(10);
    expect(Equal.distance(c, null, 'foo', 'foo')).toBe(0);
    expect(Equal.distance(c, null, 'foo', 'bar')).toBe(10);
  });
  it('compares values in two arrays', () => {
    expect(
      Equal.distance(c, null, [23, 'foo', 0, 2], ['foo', 1, 23, 42])
    ).toBe(5);
  });
});

describe('Test (legacy metric parity)', () => {
  const c = { attribute: '' } as any;
  it('tests whether an attribute exists', () => {
    expect(Test.score(c, null, 42)).toBe(1);
    expect(Test.score(c, null, 'foo')).toBe(1);
    expect(Test.score(c, null, 0)).toBe(1);
    expect(Test.score(c, null, [])).toBe(0);
    expect(Test.score(c, null, null)).toBe(0);
    expect(Test.score(c, null, undefined)).toBe(0);
  });
  it('rewards and penalise', () => {
    expect(Test.score({ ...c, reward: 23 }, null, 42)).toBe(23);
    expect(Test.score({ ...c, penalty: -23 }, null, null)).toBe(-23);
  });
  it('tests whether a string is contained', () => {
    expect(Test.score({ ...c, expression: 'foo' }, null, 'foobar')).toBe(1);
    expect(Test.score({ ...c, expression: 'foo' }, null, 'barfoo')).toBe(1);
    expect(Test.score({ ...c, expression: 'foo' }, null, 'bar')).toBe(0);
  });
  it('tests a regular expression', () => {
    expect(Test.score({ ...c, expression: /fo{2}b/ }, null, 'foobar')).toBe(1);
    expect(Test.score({ ...c, expression: /fo{3}b/ }, null, 'foobar')).toBe(0);
    expect(Test.score({ ...c, expression: /^foobar$/ }, null, 'foobar')).toBe(
      1
    );
    expect(Test.score({ ...c, expression: /^bar$/ }, null, 'foobar')).toBe(0);
  });
  it('tests a custom expression', () => {
    expect(
      Test.score({ ...c, expression: (x: any) => x === 23 }, null, [23, 42])
    ).toBe(1);
  });
});

describe('IQR (legacy metric parity)', () => {
  const c = { attribute: '' } as any;
  it('scores correctly around the IQR', () => {
    const values = [0, 10, 20, 30, 100];
    const config = { ...c, iqr: 0, smooth: 0 };
    const cache = IQR.cache!(config, values, noop);
    expect(values.map(v => IQR.score(config, cache, v))).toEqual([
      0, 1, 1, 1, 0,
    ]);
  });
  it('scores correctly around the 1 IQR', () => {
    const values = [0, 10, 20, 30, 100];
    const config = { ...c, iqr: 1, smooth: 0 };
    const cache = IQR.cache!(config, values, noop);
    expect(values.map(v => IQR.score(config, cache, v))).toEqual([
      1, 1, 1, 1, 0,
    ]);
  });
  it('rewards and penalises', () => {
    const values = [0, 10, 20, 30, 100];
    const config = { ...c, iqr: 0, smooth: 0, reward: 42, penalty: -23 };
    const cache = IQR.cache!(config, values, noop);
    expect(values.map(v => IQR.score(config, cache, v))).toEqual([
      -23, 42, 42, 42, -23,
    ]);
  });
  it('scores correctly using smoothing', () => {
    const values = [0, 5, 10, 10, 15, 20, 25, 30, 30, 45, 50];
    const config = { ...c, iqr: 0, smooth: 0.25 };
    const cache = IQR.cache!(config, values, noop);
    expect(values.map(v => IQR.score(config, cache, v))).toEqual([
      0, 0, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 0, 0,
    ]);
    expect(IQR.score(config, cache, 10)).toBe(0.5);
    expect(IQR.score(config, cache, 30)).toBe(0.5);
  });
});

describe('Rank (legacy metric parity)', () => {
  const c = {} as any;
  it('ranks correctly', () => {
    const cache = Rank.cache!(c, [4, 2, 3, 2, 42, 23], noop);
    expect(Rank.score(c, cache, 2)).toBe(0);
    expect(Rank.score(c, cache, 23)).toBe(0.75);
    expect(Rank.score(c, cache, 42)).toBe(1);
  });
  it('handles null values', () => {
    const cache = Rank.cache!(
      c,
      [4, 2, undefined, null, 3, 2, 42, null, 23],
      noop
    );
    expect(Rank.score(c, cache, 2)).toBe(0);
    expect(Rank.score(c, cache, 23)).toBe(0.75);
    expect(Rank.score(c, cache, 42)).toBe(1);
  });
  it('handle non-existent values', () => {
    const cache = Rank.cache!(c, [4, 2, 42], noop);
    expect(Rank.score(c, cache, 23)).toBeNull();
  });
});
