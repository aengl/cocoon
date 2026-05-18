import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Downstream of `RateGames` — the demo's "what did we just annotate?" payoff.
 * One bespoke node carrying BOTH control tiers (keystone 5), on purpose:
 *
 *  - **Steering controls** (the simple inline tier): `metric`, `order`,
 *    `includeUnrated`. These genuinely change the *emitted* distribution, so
 *    they belong in `process()` (`ctx.controls.read()`) — set one → the node
 *    goes `stale` → you re-pull. That re-pull is not friction, it's the
 *    lesson: steering changes **data**, the pull is the commit, and the
 *    visualization (which reads the committed output) then reflects it.
 *
 *  - **The histogram is a free-form complex control used as a View** (the
 *    action tier, the point of the demo): `control.data()` derives a bounded
 *    payload from the node's *frozen pull output* (`ctx.output.histogram` —
 *    the keystone-5 "frozen batch" read), `control.render()` turns it into
 *    inert zero-dep SVG per surface (mini bars on the node, full chart in the
 *    window). There is deliberately **no `event` handler**: a legacy View is
 *    exactly `serialiseViewData` + a render half; this is `control.data` +
 *    `control.render` and nothing else — the sharpest demonstration that the
 *    control mechanism *subsumes* the View concept (no View registry, no
 *    `view:` string, no framework — the node renders its own SVG and the
 *    generic shim just mounts it).
 *
 * Why the viz can't read the knobs itself: `ControlContext` has no
 * `controls` (steering is `process()`-only by contract). So the knobs MUST
 * flow knob → process → `ctx.output` → control. That coupling *is* the pull
 * graph; surfacing it is good pedagogy, not a limitation worked around.
 */

type Row = Record<string, unknown>;

interface Bin {
  /** The rating this bucket counts (1..5), or null for the unrated bucket. */
  rating: number | null;
  label: string; // x-axis label ("1".."5" or "—")
  count: number; // raw rows in the bucket (always; the durable truth)
  value: number; // what the bars encode: count, or percent under `metric`
}

interface HistOut {
  bins: Bin[];
  metric: 'count' | 'percent';
  total: number; // denominator (rated, or rated+unrated under includeUnrated)
  avg: number | null; // mean star rating over *rated* rows (null = none yet)
}

export const RatingHistogram: CocoonProcessNode = {
  category: 'Visualisation',
  description: 'Rating distribution as a control-rendered SVG histogram.',

  controls: {
    metric: {
      kind: 'select',
      label: 'show',
      options: ['count', 'percent'],
      default: 'count',
    },
    order: {
      kind: 'select',
      label: 'order',
      options: ['rating', 'frequency'],
      default: 'rating',
    },
    includeUnrated: {
      kind: 'toggle',
      label: 'include unrated',
      default: false,
    },
  },

  // Pure transform. Reads the steering knobs and emits the distribution as a
  // real output port (`histogram`) — so it is ordinary data-flow (a
  // downstream node could consume it) and the free-form control reads it
  // back via `ctx.output`. `data` passes through unchanged (good citizen).
  async *process(ctx) {
    const { data } = ctx.ports.read() as { data?: Row[] };
    const { metric, order, includeUnrated } = ctx.controls.read() as {
      metric: 'count' | 'percent';
      order: 'rating' | 'frequency';
      includeUnrated: boolean;
    };
    const rows = Array.isArray(data) ? data : [];

    const ratingOf = (r: Row): number | null => {
      const v = Number(r.rating);
      return Number.isFinite(v) && v >= 1 && v <= 5 ? Math.round(v) : null;
    };
    const counts = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    let unrated = 0;
    for (const r of rows) {
      const n = ratingOf(r);
      if (n == null) unrated++;
      else counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const ratedTotal = rows.length - unrated;
    const denom = includeUnrated ? rows.length : ratedTotal;

    let bins: Bin[] = [1, 2, 3, 4, 5].map(n => ({
      rating: n,
      label: String(n),
      count: counts.get(n) ?? 0,
      value: 0,
    }));
    if (includeUnrated)
      bins.push({ rating: null, label: '—', count: unrated, value: 0 });
    for (const b of bins)
      b.value =
        metric === 'percent'
          ? denom > 0
            ? Math.round((b.count / denom) * 1000) / 10
            : 0
          : b.count;
    if (order === 'frequency')
      bins = [...bins].sort((a, b) => b.count - a.count);

    const sum = [1, 2, 3, 4, 5].reduce(
      (s, n) => s + n * (counts.get(n) ?? 0),
      0
    );
    const avg = ratedTotal > 0 ? Math.round((sum / ratedTotal) * 10) / 10 : null;

    const out: HistOut = { bins, metric, total: denom, avg };
    ctx.ports.write({ data: rows, histogram: out });
    return `${ratedTotal}/${rows.length} rated${
      avg != null ? ` · avg ★${avg}` : ''
    } · ${metric}`;
  },

  control: {
    // Data half — the `serialiseViewData` twin. Reads the *frozen pull
    // output* (so it reflects the steering knobs as of the last pull, the
    // keystone-5 frozen-batch mode), bounds it, and hands it to render.
    async data(ctx): Promise<{ ready: boolean } & Partial<HistOut> & {
      max?: number;
    }> {
      const h = (ctx.output.histogram as HistOut | undefined) ?? undefined;
      if (!h || !Array.isArray(h.bins) || h.bins.length === 0)
        return { ready: false };
      return {
        ready: true,
        bins: h.bins.slice(0, 6), // ≤6 buckets — bounded payload
        metric: h.metric,
        total: h.total,
        avg: h.avg,
        max: Math.max(1, ...h.bins.map(b => b.value)),
      };
    },

    render(ctx) {
      const d = ctx.data as {
        ready: boolean;
        bins?: Bin[];
        metric?: 'count' | 'percent';
        total?: number;
        avg?: number | null;
        max?: number;
      };
      const compact = ctx.surface === 'node';

      if (!d?.ready) {
        const msg = 'run the node to build the histogram';
        return compact
          ? `<div class="histo-compact"><strong>Ratings</strong><p>${msg}</p>
  <button data-cocoon-event="$open">Open chart ▸</button></div>`
          : `<div class="histo"><p>${msg} — change a knob then ▶ re-run; the chart reads the committed output.</p></div>`;
      }

      const bins = d.bins!;
      const max = d.max!;
      const unit = d.metric === 'percent' ? '%' : '';
      const fmtV = (v: number) =>
        d.metric === 'percent' ? `${v}${unit}` : String(v);

      // --- compact node surface: a tiny bar row + summary + open ----------
      if (compact) {
        const bw = 100 / bins.length;
        const bars = bins
          .map(b => {
            const hpct = Math.max(3, (b.value / max) * 100);
            return `<span class="hb" style="left:${(bins.indexOf(b) * bw).toFixed(2)}%;width:${(bw - 3).toFixed(2)}%;height:${hpct.toFixed(1)}%" title="${b.label}: ${fmtV(b.value)}"></span>`;
          })
          .join('');
        return `<div class="histo-compact">
  <strong>Ratings</strong>
  <div class="spark">${bars}</div>
  <p>${d.total} ${d.metric}${d.avg != null ? ` · avg ★${d.avg}` : ''}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }

      // --- window surface: a full zero-dep inline SVG histogram ----------
      const W = 440;
      const H = 250;
      const m = { l: 38, r: 16, t: 30, b: 32 };
      const iw = W - m.l - m.r;
      const ih = H - m.t - m.b;
      const slot = iw / bins.length;
      const bw = Math.min(54, slot * 0.7);
      const sy = (v: number) => m.t + ih - (v / max) * ih;

      const gridVals = [0, max / 2, max].map(
        v => Math.round(v * 10) / 10
      );
      const grid = gridVals
        .map(
          v =>
            `<line x1="${m.l}" y1="${sy(v).toFixed(1)}" x2="${
              W - m.r
            }" y2="${sy(v).toFixed(1)}" stroke="#27272a" />` +
            `<text x="${m.l - 5}" y="${(sy(v) + 3).toFixed(
              1
            )}" fill="#71717a" font-size="9" text-anchor="end">${v}${unit}</text>`
        )
        .join('');

      const bars = bins
        .map((b, i) => {
          const cx = m.l + i * slot + slot / 2;
          const x = cx - bw / 2;
          const top = sy(b.value);
          const bh = m.t + ih - top;
          const fill = b.rating == null ? '#52525b' : '#fbbf24';
          return `<rect x="${x.toFixed(1)}" y="${top.toFixed(
            1
          )}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(
            1
          )}" rx="2" fill="${fill}" />` +
            `<text x="${cx.toFixed(1)}" y="${(top - 5).toFixed(
              1
            )}" fill="#e4e4e7" font-size="10" text-anchor="middle">${fmtV(
              b.value
            )}</text>` +
            `<text x="${cx.toFixed(1)}" y="${(H - m.b + 14).toFixed(
              1
            )}" fill="#a1a1aa" font-size="10" text-anchor="middle">${
              b.rating == null ? '—' : '★'.repeat(b.rating)
            }</text>`;
        })
        .join('');

      const title = `${d.total} rated · ${d.metric}${
        d.avg != null ? ` · mean ★${d.avg}` : ''
      }`;

      return `<div class="histo">
  <svg viewBox="0 0 ${W} ${H}" class="histo-svg" preserveAspectRatio="xMidYMid meet">
    <text x="${m.l}" y="16" fill="#c4b5fd" font-size="11">${title}</text>
    ${grid}
    <line x1="${m.l}" y1="${m.t + ih}" x2="${W - m.r}" y2="${
      m.t + ih
    }" stroke="#3f3f46" />
    ${bars}
  </svg>
  <p class="histo-foot">steered by the inline knobs on the node — change one, ▶ re-run, watch it move (steering = data, the pull is the commit).</p>
</div>`;
    },
  },
};
