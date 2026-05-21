import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * K-means clustering on the enriched film catalogue — the data-processing
 * heart of the example. Given `k` and a minimum vote-count gate, the node:
 *
 *   1. filters to films with positive budget+revenue+runtime and
 *      vote_count ≥ `min_vote_count` (this strips a small "$0 budget" data-
 *      quality outlier population that TMDB exposes for partially-disclosed
 *      films);
 *   2. projects each film into a 5-dim feature space — log10(budget),
 *      log10(revenue), vote_average, log10(vote_count), runtime — and
 *      z-scores each dimension;
 *   3. runs k-means with k-means++ initialisation (deterministic by `seed`)
 *      to convergence or 50 iterations, whichever comes first;
 *   4. for every cluster, derives a *real-unit* centroid (de-zscored), the
 *      5 films closest to the centroid in z-space (exemplars), genre
 *      frequencies, and aggregate stats (mean ROI etc.); and
 *   5. emits two ports — `movies` tagged with `cluster_id` for downstream
 *      consumers, and `clusters` carrying the per-cluster summary the
 *      window-surface card grid renders.
 *
 * The point isn't the algorithm (it's ~60 lines of textbook TS) — it's
 * that running it over the catalogue surfaces five recognisable
 * archetypes ("tentpole prestige", "mid-major commercial", "mid-budget
 * flops", "quiet prestige", "microbudget") whose membership stats line up
 * with — and explain — the budget-evolution chart upstream: the
 * "mid-budget flops" cluster is the lowest-rated, weakest-ROI archetype,
 * which is exactly the tier the barbell hollowed out.
 *
 * Symmetric-import rule: a co-located `hook` is *not* shipped here (the
 * card grid is pure HTML/CSS, no browser-side JS needed), so top-level
 * `import type` is fine. The algorithm uses zero external deps.
 */

interface EnrichedRow {
  id: number;
  title: string;
  release_year: number;
  budget: number;
  revenue: number;
  runtime: number | null;
  vote_average: number;
  vote_count: number;
  genres: string[];
  poster_path: string | null;
}

interface ClusteredRow extends EnrichedRow {
  cluster_id: number;
}

interface ClusterSummary {
  id: number;
  n: number;
  // Real-unit centroid (after de-zscoring) for human reading.
  centroid: {
    budget: number;
    revenue: number;
    vote_avg: number;
    vote_count: number;
    runtime: number;
  };
  // Per-cluster aggregates (means).
  stats: {
    mean_budget: number;
    mean_revenue: number;
    mean_roi: number;
    mean_rating: number;
    mean_runtime: number;
    mean_votes: number;
  };
  // Z-scored centroid (so the card UI can render "how extreme is this
  // cluster on each axis" bars without re-deriving from the raw means).
  z_centroid: {
    log_budget: number;
    log_revenue: number;
    vote_avg: number;
    log_votes: number;
    runtime: number;
  };
  // Top 5 genres with absolute counts; UI divides by n for percent.
  top_genres: Array<{ name: string; count: number }>;
  // 5 films closest to the centroid in z-space.
  exemplars: Array<{
    id: number;
    title: string;
    year: number;
    poster_path: string | null;
    budget: number;
    revenue: number;
    rating: number;
  }>;
}

const FEATURE_NAMES = [
  'log_budget',
  'log_revenue',
  'vote_avg',
  'log_votes',
  'runtime',
] as const;

export const ClusterMovies: CocoonProcessNode = {
  category: 'TMDB',
  description: 'k-means archetype discovery on the enriched catalogue.',

  controls: {
    k: {
      kind: 'number',
      label: 'k (clusters)',
      default: 6,
      min: 3,
      max: 10,
      step: 1,
    },
    min_vote_count: {
      kind: 'number',
      label: 'min vote_count',
      default: 100,
      min: 0,
      max: 5000,
      step: 50,
    },
    seed: {
      kind: 'number',
      label: 'seed (for determinism)',
      default: 42,
      min: 1,
      max: 99999,
      step: 1,
    },
  },

  async *process(ctx) {
    const { movies } = ctx.ports.read() as { movies?: EnrichedRow[] };
    const { k, min_vote_count, seed } = ctx.controls.read() as {
      k: number;
      min_vote_count: number;
      seed: number;
    };

    const rows = (Array.isArray(movies) ? movies : []).filter(
      m =>
        m.budget > 0 &&
        m.revenue > 0 &&
        (m.runtime ?? 0) > 0 &&
        m.vote_count >= min_vote_count
    );
    if (rows.length === 0) {
      ctx.ports.write({ movies: [], clusters: [] });
      return 'no rows after filter';
    }
    if (rows.length < k * 2) {
      throw new Error(
        `not enough rows (${rows.length}) for k=${k} — lower min_vote_count or k`
      );
    }

    yield `clustering ${rows.length} films (k=${k}, seed=${seed})…`;

    // ----- feature projection (long-tail dims logged, then z-scored) -----
    const X: number[][] = rows.map(m => [
      Math.log10(m.budget),
      Math.log10(m.revenue),
      m.vote_average,
      Math.log10(m.vote_count),
      m.runtime!,
    ]);
    const nF = FEATURE_NAMES.length;
    const means: number[] = new Array(nF).fill(0);
    for (const r of X) for (let j = 0; j < nF; j++) means[j] += r[j];
    for (let j = 0; j < nF; j++) means[j] /= X.length;
    const stds: number[] = new Array(nF).fill(0);
    for (const r of X)
      for (let j = 0; j < nF; j++) stds[j] += (r[j] - means[j]) ** 2;
    for (let j = 0; j < nF; j++)
      stds[j] = Math.sqrt(stds[j] / X.length) || 1;
    const Z: number[][] = X.map(r =>
      r.map((v, j) => (v - means[j]) / stds[j])
    );

    // ----- k-means with k-means++ init (seeded LCG for determinism) -----
    const rand = mulberry32(seed);
    const centers = kmeanspp(Z, k, rand);
    const assign: number[] = new Array(Z.length).fill(0);
    const MAX_ITERS = 50;
    let iters = 0;
    for (; iters < MAX_ITERS; iters++) {
      let changed = false;
      for (let i = 0; i < Z.length; i++) {
        let best = 0;
        let bd = sqdist(Z[i], centers[0]);
        for (let ci = 1; ci < k; ci++) {
          const dd = sqdist(Z[i], centers[ci]);
          if (dd < bd) {
            bd = dd;
            best = ci;
          }
        }
        if (assign[i] !== best) {
          assign[i] = best;
          changed = true;
        }
      }
      if (!changed && iters > 0) break;
      // recompute centroids
      const sums: number[][] = Array.from({ length: k }, () =>
        new Array(nF).fill(0)
      );
      const counts: number[] = new Array(k).fill(0);
      for (let i = 0; i < Z.length; i++) {
        counts[assign[i]]++;
        const r = Z[i];
        for (let j = 0; j < nF; j++) sums[assign[i]][j] += r[j];
      }
      for (let ci = 0; ci < k; ci++) {
        if (counts[ci] === 0) {
          // Re-seed any empty centroid to a random data point.
          centers[ci] = [...Z[Math.floor(rand() * Z.length)]];
          continue;
        }
        for (let j = 0; j < nF; j++) centers[ci][j] = sums[ci][j] / counts[ci];
      }
    }

    // ----- per-cluster summarisation -----
    const buckets: number[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < Z.length; i++) buckets[assign[i]].push(i);

    const clusters: ClusterSummary[] = [];
    for (let ci = 0; ci < k; ci++) {
      const idxs = buckets[ci];
      if (idxs.length === 0) continue;
      // Real-unit centroid (de-zscore + un-log for log_* dims).
      const cReal = {
        budget: Math.pow(10, centers[ci][0] * stds[0] + means[0]),
        revenue: Math.pow(10, centers[ci][1] * stds[1] + means[1]),
        vote_avg: centers[ci][2] * stds[2] + means[2],
        vote_count: Math.pow(10, centers[ci][3] * stds[3] + means[3]),
        runtime: centers[ci][4] * stds[4] + means[4],
      };
      // Aggregates.
      let mB = 0, mR = 0, mV = 0, mT = 0, mC = 0, mROI = 0;
      for (const i of idxs) {
        const m = rows[i];
        mB += m.budget;
        mR += m.revenue;
        mV += m.vote_average;
        mT += m.runtime!;
        mC += m.vote_count;
        mROI += m.revenue / m.budget;
      }
      const n = idxs.length;
      // Top genres.
      const gc = new Map<string, number>();
      for (const i of idxs)
        for (const g of rows[i].genres) gc.set(g, (gc.get(g) ?? 0) + 1);
      const top_genres = [...gc.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));
      // Exemplars — closest to centroid in z-space.
      const exemplars = [...idxs]
        .sort((a, b) => sqdist(Z[a], centers[ci]) - sqdist(Z[b], centers[ci]))
        .slice(0, 5)
        .map(i => ({
          id: rows[i].id,
          title: rows[i].title,
          year: rows[i].release_year,
          poster_path: rows[i].poster_path,
          budget: rows[i].budget,
          revenue: rows[i].revenue,
          rating: rows[i].vote_average,
        }));
      clusters.push({
        id: ci,
        n,
        centroid: cReal,
        stats: {
          mean_budget: mB / n,
          mean_revenue: mR / n,
          mean_roi: mROI / n,
          mean_rating: mV / n,
          mean_runtime: mT / n,
          mean_votes: mC / n,
        },
        z_centroid: {
          log_budget: centers[ci][0],
          log_revenue: centers[ci][1],
          vote_avg: centers[ci][2],
          log_votes: centers[ci][3],
          runtime: centers[ci][4],
        },
        top_genres,
        exemplars,
      });
    }
    // Sort clusters by n descending — the card grid reads largest first.
    clusters.sort((a, b) => b.n - a.n);

    const tagged: ClusteredRow[] = rows.map((m, i) => ({
      ...m,
      cluster_id: assign[i],
    }));
    ctx.ports.write({ movies: tagged, clusters });

    return `${clusters.length} clusters · ${rows.length} films · converged in ${iters} iters`;
  },

  control: {
    window: { width: 1080, height: 640 },

    data(ctx): ClusterSummary[] {
      const c = ctx.output.clusters as ClusterSummary[] | undefined;
      return c ?? [];
    },

    render(ctx) {
      const clusters = (ctx.data as ClusterSummary[]) ?? [];
      const compact = ctx.surface === 'node';
      if (clusters.length === 0) {
        return compact
          ? `${STYLE}<div class="cl-compact"><strong>Movie clusters</strong><p>pull upstream first</p>
  <button data-cocoon-event="$open">Open clusters ▸</button></div>`
          : `${STYLE}<div class="cl"><p class="empty">No clusters — pull EnrichMovies upstream.</p></div>`;
      }
      const total = clusters.reduce((s, c) => s + c.n, 0);
      if (compact) {
        return `${STYLE}<div class="cl-compact">
  <strong>${clusters.length} archetypes</strong>
  <p>${total} films · best ROI: ${labelOf(bestBy(clusters, c => c.stats.mean_roi))} · best rated: ${labelOf(bestBy(clusters, c => c.stats.mean_rating))}</p>
  <button data-cocoon-event="$open">Open clusters ▸</button>
</div>`;
      }
      return `${STYLE}<div class="cl">
  <header class="head">
    <h1>${clusters.length} film archetypes</h1>
    <p class="sub">${total} films · k-means on log(budget), log(revenue), rating, log(votes), runtime — z-scored</p>
  </header>
  <div class="grid">
    ${clusters.map(c => renderCard(c, total)).join('\n')}
  </div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------
// Card rendering — pure HTML/CSS, no browser-side JS hook needed.
// ---------------------------------------------------------------------------

function renderCard(c: ClusterSummary, total: number): string {
  const label = labelOf(c);
  const pct = (n: number) => `${Math.round((100 * n) / c.n)}%`;
  const genres = c.top_genres
    .slice(0, 3)
    .map(g => `<span class="g">${esc(g.name)} <em>${pct(g.count)}</em></span>`)
    .join('');
  const exemplars = c.exemplars
    .slice(0, 4)
    .map(
      e =>
        `<li><span class="t" title="${esc(e.title)} (${e.year}) · $${fmtM(e.budget)} → $${fmtM(e.revenue)} · ${fmt(e.rating, 1)}">${esc(e.title)}</span></li>`
    )
    .join('');
  // z-score axis bars — shows where this cluster sits on each dim.
  const axes: Array<[string, number]> = [
    ['budget', c.z_centroid.log_budget],
    ['revenue', c.z_centroid.log_revenue],
    ['rating', c.z_centroid.vote_avg],
    ['votes', c.z_centroid.log_votes],
    ['runtime', c.z_centroid.runtime],
  ];
  const bars = axes
    .map(([k, z]) => {
      const w = Math.max(2, Math.min(50, Math.abs(z) * 22));
      const dir = z >= 0 ? 'pos' : 'neg';
      return `<div class="axis"><span class="ax-name">${k}</span><span class="ax-bar ${dir}" style="width:${w}px"></span><span class="ax-val">${z >= 0 ? '+' : ''}${z.toFixed(1)}</span></div>`;
    })
    .join('');
  return `<article class="card">
  <header><h2>${esc(label)}</h2><span class="n">${c.n} films · ${Math.round((100 * c.n) / total)}%</span></header>
  <div class="kpis">
    <div><span class="kv">$${fmtM(c.stats.mean_budget)}</span><span class="kl">budget</span></div>
    <div><span class="kv">$${fmtM(c.stats.mean_revenue)}</span><span class="kl">revenue</span></div>
    <div><span class="kv">${fmt(c.stats.mean_roi, 1)}×</span><span class="kl">ROI</span></div>
    <div><span class="kv">${fmt(c.stats.mean_rating, 2)}</span><span class="kl">rating</span></div>
    <div><span class="kv">${Math.round(c.stats.mean_runtime)}m</span><span class="kl">runtime</span></div>
  </div>
  <div class="axes">${bars}</div>
  <div class="genres">${genres}</div>
  <ul class="exemplars">${exemplars}</ul>
</article>`;
}

// Heuristic label from the z-centroid's extremes — three-dim "high X / low Y"
// reading of the centroid, so the same algorithm labels any clustering, not
// just the default k=6 one. Keeps the node generic; tuned labels would belong
// in a downstream "annotate" node.
function labelOf(c: ClusterSummary): string {
  const z = c.z_centroid;
  const dims: Array<[string, number]> = [
    ['budget', z.log_budget],
    ['revenue', z.log_revenue],
    ['rating', z.vote_avg],
    ['popularity', z.log_votes],
    ['runtime', z.runtime],
  ];
  const sorted = [...dims].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const word = (name: string, z: number) =>
    `${z >= 0 ? '↑' : '↓'} ${name}`;
  return sorted
    .slice(0, 2)
    .map(([n, z]) => word(n, z))
    .join(' · ');
}

function bestBy<T>(arr: T[], f: (x: T) => number): T {
  let best = arr[0];
  let bv = f(best);
  for (const x of arr) {
    const v = f(x);
    if (v > bv) {
      bv = v;
      best = x;
    }
  }
  return best;
}

function fmt(n: number, d = 2): string {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}
function fmtM(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}
function esc(v: unknown): string {
  return String(v == null ? '' : v).replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!
  );
}

// ---------------------------------------------------------------------------
// k-means primitives.
// ---------------------------------------------------------------------------

function sqdist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function kmeanspp(Z: number[][], k: number, rand: () => number): number[][] {
  const centers: number[][] = [];
  centers.push([...Z[Math.floor(rand() * Z.length)]]);
  for (let c = 1; c < k; c++) {
    let total = 0;
    const d2 = new Array<number>(Z.length);
    for (let i = 0; i < Z.length; i++) {
      let best = sqdist(Z[i], centers[0]);
      for (let j = 1; j < centers.length; j++) {
        const dd = sqdist(Z[i], centers[j]);
        if (dd < best) best = dd;
      }
      d2[i] = best;
      total += best;
    }
    let pick = rand() * total;
    let acc = 0;
    let idx = Z.length - 1;
    for (let i = 0; i < Z.length; i++) {
      acc += d2[i];
      if (acc >= pick) {
        idx = i;
        break;
      }
    }
    centers.push([...Z[idx]]);
  }
  return centers;
}

// Seeded RNG — Mulberry32; tiny, deterministic, plenty good for k-means++.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------

const STYLE = `<style>
.control .cl-compact { display:flex; flex-direction:column; gap:6px; }
.control .cl-compact strong { font-size:12px; color:#fb923c; }
.control .cl-compact p { margin:0; color:#9a9aa6; font-size:11px; font-variant-numeric:tabular-nums; }
.control .cl-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .cl-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .cl { display:flex; flex-direction:column; gap:12px; height:100%; color:#e7e7ea; font-size:11.5px; }
.control .cl .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .cl .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .cl .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
.control .cl .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:10px; overflow-y:auto; padding-right:4px; }

.control .cl .card { background:#15151b; border:1px solid #2a2a31; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.control .cl .card header { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.control .cl .card header h2 { margin:0; font-size:12.5px; color:#c4b5fd; font-weight:600; letter-spacing:0.02em; }
.control .cl .card header .n { color:#71717a; font-size:10.5px; font-variant-numeric:tabular-nums; }

.control .cl .card .kpis { display:grid; grid-template-columns:repeat(5, 1fr); gap:4px; }
.control .cl .card .kpis div { display:flex; flex-direction:column; align-items:center; padding:4px 2px; background:#0d0d11; border-radius:4px; }
.control .cl .card .kpis .kv { font-size:11.5px; color:#fbbf24; font-weight:600; font-variant-numeric:tabular-nums; line-height:1.1; }
.control .cl .card .kpis .kl { font-size:9px; color:#71717a; text-transform:uppercase; letter-spacing:0.05em; margin-top:2px; }

.control .cl .card .axes { display:flex; flex-direction:column; gap:2px; }
.control .cl .card .axis { display:grid; grid-template-columns:60px 1fr 36px; align-items:center; gap:6px; font-size:10px; }
.control .cl .card .axis .ax-name { color:#9a9aa6; text-align:right; }
.control .cl .card .axis .ax-bar { display:inline-block; height:5px; border-radius:1px; }
.control .cl .card .axis .ax-bar.pos { background:#fb923c; margin-right:auto; }
.control .cl .card .axis .ax-bar.neg { background:#475569; margin-left:auto; }
.control .cl .card .axis .ax-bar { justify-self:start; }
.control .cl .card .axis .ax-bar.neg { justify-self:end; }
.control .cl .card .axis .ax-val { color:#71717a; font-variant-numeric:tabular-nums; font-size:9.5px; text-align:right; }

.control .cl .card .genres { display:flex; flex-wrap:wrap; gap:4px; }
.control .cl .card .genres .g { background:#1f1f27; color:#9a9aa6; padding:2px 6px; border-radius:3px; font-size:10px; }
.control .cl .card .genres .g em { color:#71717a; font-style:normal; font-size:9px; margin-left:2px; }

.control .cl .card .exemplars { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:1px; }
.control .cl .card .exemplars li { font-size:10.5px; color:#a1a1aa; padding:1px 0; }
.control .cl .card .exemplars .t { display:inline-block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
</style>`;
