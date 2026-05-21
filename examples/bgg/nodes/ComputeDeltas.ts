import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Pure transform — fold a `delta` column onto every row, optionally bench-
 * marking against the community Bayesian average (which damps games with
 * few voters toward the global mean — closer to "what the BGG ranking
 * actually shows" than the raw simple-average).
 *
 * The whole bias-analysis story rides on this column; isolating it as
 * its own node means downstream nodes never re-implement "what's a delta"
 * and the rule is one place to change.
 *
 * Also computes a couple of summary stats and emits them on a second
 * output port so other nodes (and the agent, via `query peek`) can read
 * the headline numbers without re-deriving them.
 */

interface Row {
  id: string;
  name: string;
  own_rating: number;
  community_avg: number;
  community_bayes: number;
  num_ratings: number;
  weight?: number;
  [k: string]: unknown;
}

interface Summary {
  n: number;
  mean_own: number;
  mean_community: number;
  mean_delta: number;
  median_delta: number;
  stddev_delta: number;
  benchmark: 'average' | 'bayesian';
}

export const ComputeDeltas: CocoonProcessNode = {
  category: 'BGG',
  description:
    'Add delta = own_rating − community baseline; emit summary stats.',

  controls: {
    benchmark: {
      kind: 'select',
      label: 'compare against',
      options: ['average', 'bayesian'],
      default: 'average',
    },
    minVoters: {
      kind: 'number',
      label: 'drop games with < N voters',
      default: 30,
      min: 0,
      max: 10000,
      step: 10,
    },
  },

  async *process(ctx) {
    const { games } = ctx.ports.read() as { games?: Row[] };
    const { benchmark, minVoters } = ctx.controls.read() as {
      benchmark: 'average' | 'bayesian';
      minVoters: number;
    };
    const rows = Array.isArray(games) ? games : [];

    const valid = rows.filter(
      r =>
        r.own_rating > 0 &&
        r.community_avg > 0 &&
        r.num_ratings >= minVoters
    );

    const withDelta = valid.map(r => {
      const baseline =
        benchmark === 'bayesian' && r.community_bayes > 0
          ? r.community_bayes
          : r.community_avg;
      return {
        ...r,
        baseline,
        delta: round3(r.own_rating - baseline),
      };
    });

    const deltas = withDelta.map(r => r.delta);
    const summary: Summary = {
      n: withDelta.length,
      mean_own: round3(mean(withDelta.map(r => r.own_rating))),
      mean_community: round3(mean(withDelta.map(r => r.baseline))),
      mean_delta: round3(mean(deltas)),
      median_delta: round3(median(deltas)),
      stddev_delta: round3(stddev(deltas)),
      benchmark,
    };

    ctx.ports.write({ games: withDelta, summary });
    const sign = summary.mean_delta >= 0 ? '+' : '';
    return `n=${summary.n} · mean Δ ${sign}${summary.mean_delta}`;
  },
};

// ---------------------------------------------------------------------------

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (xs.length - 1));
}
