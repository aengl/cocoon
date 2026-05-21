import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Discovery node — the quantile-binned region-mining cousin of SurfaceGroups.
 *
 * Where SurfaceGroups looks for concentrations along (categorical genre ×
 * time-window), this looks for them along (numeric × numeric): two axes,
 * each binned into quantiles, then every cell scored on a chosen
 * interestingness lens. Surfaces rectangular regions of feature space
 * where something is unusual — high-rating + low-budget = sleeper-quality
 * zone; high-budget + low-ROI = money-pit zone; low-popularity +
 * high-rating = cult/hidden-gem zone. Each cell becomes a promotable
 * candidate group with a structured filter spec (min/max on each axis).
 *
 * Steering:
 *   x_axis / y_axis    pick from a fixed numeric vocabulary
 *   bins               quantile bins per axis (default 4 = quartiles)
 *   surface_by         density | rating | roi | popularity — the lens
 *   top_k              how many candidate cells to keep
 *   min_obs            noise floor: cells with fewer films are dropped
 *
 * The output `grid` carries every cell (the heatmap render needs the
 * complete matrix); `candidates` carries only the top-K most surprising
 * cells under the chosen lens. Each candidate already has the YAML spec
 * pre-rendered, copy-pasteable into GenerateTopLists.conditions.
 *
 * Symmetric-import: pure HTML grid, no `hook` shipped → top-level
 * `import type` allowed; zero external deps.
 */

interface MovieRow {
  id: number;
  title: string;
  release_year: number;
  popularity: number;
  vote_average: number;
  vote_count: number;
  budget: number;
  revenue: number;
  runtime: number | null;
}

type AxisKey =
  | 'budget'
  | 'revenue'
  | 'roi'
  | 'rating'
  | 'popularity'
  | 'votes'
  | 'runtime'
  | 'year';

type LensKey = 'density' | 'rating' | 'roi' | 'popularity';

interface AxisDef {
  label: string;
  unit: string;
  // (m) → value; null = drop this film for this axis (e.g. roi with budget=0)
  get: (m: MovieRow) => number | null;
  // For pretty-printing bin edges.
  format: (v: number) => string;
  // Maps to GenerateTopLists.Condition keys (min/max). Undefined = use `where:`.
  field?: { min: string; max: string };
}

const AXES: Record<AxisKey, AxisDef> = {
  budget: {
    label: 'Budget',
    unit: '$',
    get: m => (m.budget > 0 ? m.budget : null),
    format: v => `$${fmtM(v)}`,
    field: { min: 'min_budget', max: 'max_budget' },
  },
  revenue: {
    label: 'Revenue',
    unit: '$',
    get: m => (m.revenue > 0 ? m.revenue : null),
    format: v => `$${fmtM(v)}`,
    field: { min: 'min_revenue', max: 'max_revenue' },
  },
  roi: {
    label: 'ROI',
    unit: '×',
    get: m => (m.budget > 0 && m.revenue > 0 ? m.revenue / m.budget : null),
    format: v => `${v.toFixed(1)}×`,
    // ROI has no structured field — use a `where:` predicate.
  },
  rating: {
    label: 'Rating',
    unit: '★',
    get: m => (m.vote_average > 0 ? m.vote_average : null),
    format: v => v.toFixed(1),
    field: { min: 'min_rating', max: 'max_rating' },
  },
  popularity: {
    label: 'Popularity',
    unit: '',
    get: m => m.popularity,
    format: v => v.toFixed(1),
    field: { min: 'min_popularity', max: 'max_popularity' },
  },
  votes: {
    label: 'Vote count',
    unit: '',
    get: m => (m.vote_count > 0 ? m.vote_count : null),
    format: v => Math.round(v).toLocaleString(),
    field: { min: 'min_vote_count', max: 'max_vote_count' },
  },
  runtime: {
    label: 'Runtime',
    unit: 'min',
    get: m => ((m.runtime ?? 0) > 0 ? (m.runtime as number) : null),
    format: v => `${Math.round(v)}m`,
    field: { min: 'min_runtime', max: 'max_runtime' },
  },
  year: {
    label: 'Year',
    unit: '',
    get: m => m.release_year,
    format: v => String(Math.round(v)),
    field: { min: 'year_from', max: 'year_to' },
  },
};

interface Cell {
  ix: number; // x bin index
  iy: number; // y bin index
  n: number;
  mean_rating: number;
  mean_roi: number;
  mean_popularity: number;
  score: number; // by surface_by lens
}

interface GridOut {
  x_axis: AxisKey;
  y_axis: AxisKey;
  x_label: string;
  y_label: string;
  bins: number;
  // length = bins+1; bin i is [x_cuts[i], x_cuts[i+1]).
  x_cuts: number[];
  y_cuts: number[];
  cells: Cell[][];
  population: { n: number; mean_rating: number; mean_roi: number; mean_popularity: number };
  lens: LensKey;
  // Pre-formatted axis labels for the UI (saves the renderer from re-doing it).
  x_labels: string[];
  y_labels: string[];
}

interface Candidate {
  name: string;
  ix: number;
  iy: number;
  n: number;
  score: number;
  mean_rating: number;
  mean_roi: number;
  mean_popularity: number;
  // Per-axis bounds — pretty for the UI.
  x_label: string;
  y_label: string;
  x_lo: number;
  x_hi: number;
  y_lo: number;
  y_hi: number;
  // Pre-rendered YAML to paste into GenerateTopLists.conditions.
  yaml_spec: string;
  exemplars: Array<{
    id: number;
    title: string;
    year: number;
    rating: number;
    popularity: number;
  }>;
}

export const SurfaceRegions: CocoonProcessNode = {
  category: 'TMDB',
  description: 'Quantile region mining — 2D quantile-cell density / metric spikes.',

  controls: {
    x_axis: {
      kind: 'select',
      label: 'x axis',
      options: Object.keys(AXES),
      default: 'budget',
    },
    y_axis: {
      kind: 'select',
      label: 'y axis',
      options: Object.keys(AXES),
      default: 'rating',
    },
    bins: {
      kind: 'number',
      label: 'bins per axis',
      default: 4,
      min: 2,
      max: 6,
      step: 1,
    },
    surface_by: {
      kind: 'select',
      label: 'lens (score by)',
      options: ['density', 'rating', 'roi', 'popularity'],
      default: 'rating',
    },
    top_k: {
      kind: 'number',
      label: 'top K cells',
      default: 8,
      min: 3,
      max: 30,
      step: 1,
    },
    min_obs: {
      kind: 'number',
      label: 'min observed per cell',
      default: 8,
      min: 2,
      max: 100,
      step: 1,
    },
  },

  async *process(ctx) {
    const { movies } = ctx.ports.read() as { movies?: MovieRow[] };
    const c = ctx.controls.read() as {
      x_axis: AxisKey;
      y_axis: AxisKey;
      bins: number;
      surface_by: LensKey;
      top_k: number;
      min_obs: number;
    };
    if (c.x_axis === c.y_axis)
      throw new Error('x_axis and y_axis must differ');
    const xDef = AXES[c.x_axis];
    const yDef = AXES[c.y_axis];
    if (!xDef || !yDef) throw new Error(`unknown axis ${c.x_axis}/${c.y_axis}`);

    // ----- prep: project + drop films missing either axis ------------------
    const rows = Array.isArray(movies) ? movies : [];
    type R = { m: MovieRow; x: number; y: number };
    const proj: R[] = [];
    for (const m of rows) {
      const x = xDef.get(m);
      const y = yDef.get(m);
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y))
        continue;
      proj.push({ m, x, y });
    }
    if (proj.length === 0) {
      ctx.ports.write({ movies: rows, grid: null, candidates: [] });
      return 'no rows with both axes available';
    }

    yield `binning ${proj.length} films across ${c.bins}×${c.bins} (${c.x_axis} × ${c.y_axis})…`;

    // ----- quantile cuts per axis ----------------------------------------
    const xs = proj.map(r => r.x).sort((a, b) => a - b);
    const ys = proj.map(r => r.y).sort((a, b) => a - b);
    const xCuts = quantileCuts(xs, c.bins);
    const yCuts = quantileCuts(ys, c.bins);

    // ----- assign each film to a cell ------------------------------------
    const cells: Cell[][] = Array.from({ length: c.bins }, (_, iy) =>
      Array.from({ length: c.bins }, (_, ix) => ({
        ix,
        iy,
        n: 0,
        mean_rating: 0,
        mean_roi: 0,
        mean_popularity: 0,
        score: 0,
      }))
    );
    type Acc = { n: number; rating: number; roi: number; pop: number; films: R[] };
    const acc: Acc[][] = Array.from({ length: c.bins }, () =>
      Array.from({ length: c.bins }, () => ({ n: 0, rating: 0, roi: 0, pop: 0, films: [] }))
    );
    for (const r of proj) {
      const ix = bucketize(r.x, xCuts);
      const iy = bucketize(r.y, yCuts);
      const a = acc[iy][ix];
      a.n++;
      a.rating += r.m.vote_average;
      a.pop += r.m.popularity;
      a.roi += r.m.budget > 0 ? r.m.revenue / r.m.budget : 0;
      a.films.push(r);
    }

    // ----- population baselines for the lift-based lenses ----------------
    const popMeanRating = mean(proj.map(r => r.m.vote_average));
    const popMeanPop = mean(proj.map(r => r.m.popularity));
    const popMeanRoi = mean(
      proj.filter(r => r.m.budget > 0).map(r => r.m.revenue / r.m.budget)
    );
    const total = proj.length;
    const expPerCell = total / (c.bins * c.bins);

    // ----- per-cell aggregates + score by lens ---------------------------
    for (let iy = 0; iy < c.bins; iy++) {
      for (let ix = 0; ix < c.bins; ix++) {
        const a = acc[iy][ix];
        const cell = cells[iy][ix];
        cell.n = a.n;
        cell.mean_rating = a.n > 0 ? a.rating / a.n : 0;
        cell.mean_roi = a.n > 0 ? a.roi / a.n : 0;
        cell.mean_popularity = a.n > 0 ? a.pop / a.n : 0;
        cell.score = scoreCell(cell, c.surface_by, {
          expPerCell,
          popMeanRating,
          popMeanRoi,
          popMeanPop,
        });
      }
    }

    // ----- top-K candidate cells under the lens --------------------------
    const flat: Cell[] = [];
    for (const row of cells) for (const cell of row) flat.push(cell);
    const eligible = flat.filter(cell => cell.n >= c.min_obs);
    eligible.sort((a, b) => b.score - a.score);
    const picks = eligible.slice(0, c.top_k);

    const candidates: Candidate[] = picks.map(cell => {
      const ix = cell.ix;
      const iy = cell.iy;
      const xLo = xCuts[ix];
      const xHi = xCuts[ix + 1];
      const yLo = yCuts[iy];
      const yHi = yCuts[iy + 1];
      const films = acc[iy][ix].films;
      const exemplars = [...films]
        .sort((a, b) => b.m.popularity - a.m.popularity)
        .slice(0, 4)
        .map(r => ({
          id: r.m.id,
          title: r.m.title,
          year: r.m.release_year,
          rating: r.m.vote_average,
          popularity: r.m.popularity,
        }));
      const xLab = `${xDef.format(xLo)}–${xDef.format(xHi)}`;
      const yLab = `${yDef.format(yLo)}–${yDef.format(yHi)}`;
      const name = `${xDef.label} ${xLab} · ${yDef.label} ${yLab}`;
      const yaml_spec = renderYamlSpec(name, c.x_axis, c.y_axis, xLo, xHi, yLo, yHi);
      return {
        name,
        ix,
        iy,
        n: cell.n,
        score: +cell.score.toFixed(3),
        mean_rating: +cell.mean_rating.toFixed(2),
        mean_roi: +cell.mean_roi.toFixed(2),
        mean_popularity: +cell.mean_popularity.toFixed(2),
        x_label: xLab,
        y_label: yLab,
        x_lo: xLo,
        x_hi: xHi,
        y_lo: yLo,
        y_hi: yHi,
        yaml_spec,
        exemplars,
      };
    });

    const xLabels: string[] = [];
    const yLabels: string[] = [];
    for (let i = 0; i < c.bins; i++) {
      xLabels.push(`${xDef.format(xCuts[i])}…${xDef.format(xCuts[i + 1])}`);
      yLabels.push(`${yDef.format(yCuts[i])}…${yDef.format(yCuts[i + 1])}`);
    }

    const grid: GridOut = {
      x_axis: c.x_axis,
      y_axis: c.y_axis,
      x_label: xDef.label,
      y_label: yDef.label,
      bins: c.bins,
      x_cuts: xCuts,
      y_cuts: yCuts,
      cells,
      lens: c.surface_by,
      x_labels: xLabels,
      y_labels: yLabels,
      population: {
        n: total,
        mean_rating: +popMeanRating.toFixed(2),
        mean_roi: +popMeanRoi.toFixed(2),
        mean_popularity: +popMeanPop.toFixed(2),
      },
    };
    ctx.ports.write({ movies: rows, grid, candidates });
    return `${candidates.length} region candidates · ${c.x_axis}×${c.y_axis} (${c.bins}² grid) · lens=${c.surface_by}`;
  },

  control: {
    window: { width: 900, height: 700 },

    data(ctx) {
      return {
        grid: (ctx.output.grid as GridOut | null) ?? null,
        candidates: (ctx.output.candidates as Candidate[]) ?? [],
      };
    },

    render(ctx) {
      const d = ctx.data as { grid: GridOut | null; candidates: Candidate[] };
      const compact = ctx.surface === 'node';
      if (!d?.grid) {
        return compact
          ? `${STYLE}<div class="sr-compact"><strong>SurfaceRegions</strong><p>pull upstream first</p>
  <button data-cocoon-event="$open">Open regions ▸</button></div>`
          : `${STYLE}<div class="sr"><p class="empty">No grid — pull EnrichMovies upstream.</p></div>`;
      }
      const top = d.candidates[0];
      if (compact) {
        return `${STYLE}<div class="sr-compact">
  <strong>${d.grid.x_label} × ${d.grid.y_label}</strong>
  <p>${d.grid.population.n} films · lens: <b>${d.grid.lens}</b></p>
  ${top ? `<p class="hi">top: <b>${esc(top.name)}</b> (n=${top.n}, score=${top.score})</p>` : ''}
  <button data-cocoon-event="$open">Open regions ▸</button>
</div>`;
      }
      return `${STYLE}<div class="sr">
  <header class="head">
    <h1>Regions — ${esc(d.grid.x_label)} × ${esc(d.grid.y_label)}</h1>
    <p class="sub">${d.grid.population.n} films · ${d.grid.bins}² cells · lens <b>${esc(d.grid.lens)}</b> · baseline rating ${d.grid.population.mean_rating} · ROI ${d.grid.population.mean_roi.toFixed(2)}× · popularity ${d.grid.population.mean_popularity.toFixed(1)}</p>
  </header>
  ${renderGrid(d.grid)}
  <div class="rows">
    ${d.candidates.map(renderRow).join('\n')}
  </div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------
// Cell scoring per lens.
// ---------------------------------------------------------------------------

function scoreCell(
  cell: Cell,
  lens: LensKey,
  baselines: {
    expPerCell: number;
    popMeanRating: number;
    popMeanRoi: number;
    popMeanPop: number;
  }
): number {
  if (cell.n === 0) return 0;
  switch (lens) {
    case 'density':
      // Poisson-style z relative to uniform expectation.
      return (cell.n - baselines.expPerCell) / Math.sqrt(baselines.expPerCell);
    case 'rating':
      // mean-difference weighted by sqrt(n) — penalises tiny cells.
      return (cell.mean_rating - baselines.popMeanRating) * Math.sqrt(cell.n);
    case 'roi':
      return (cell.mean_roi - baselines.popMeanRoi) * Math.sqrt(cell.n);
    case 'popularity':
      return (cell.mean_popularity - baselines.popMeanPop) * Math.sqrt(cell.n);
  }
}

// ---------------------------------------------------------------------------
// Quantile binning.
// ---------------------------------------------------------------------------

function quantileCuts(sorted: number[], bins: number): number[] {
  // sorted ascending; returns bins+1 edges. First = min, last = max + ε so
  // the right-most film's bucket includes itself.
  const n = sorted.length;
  const cuts: number[] = [sorted[0]];
  for (let i = 1; i < bins; i++) {
    const idx = Math.floor((i * n) / bins);
    cuts.push(sorted[Math.min(idx, n - 1)]);
  }
  cuts.push(sorted[n - 1] + (sorted[n - 1] - sorted[0]) * 1e-9 + 1e-9);
  return cuts;
}

function bucketize(v: number, cuts: number[]): number {
  // cuts.length = bins+1; return the bin index ∈ [0, bins).
  for (let i = 1; i < cuts.length; i++) if (v < cuts[i]) return i - 1;
  return cuts.length - 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// ---------------------------------------------------------------------------
// YAML spec generation (the bridge to GenerateTopLists).
// ---------------------------------------------------------------------------

function renderYamlSpec(
  name: string,
  xAxis: AxisKey,
  yAxis: AxisKey,
  xLo: number,
  xHi: number,
  yLo: number,
  yHi: number
): string {
  const lines: string[] = [`- name: ${name}`];
  const xDef = AXES[xAxis];
  const yDef = AXES[yAxis];
  const wheres: string[] = [];

  for (const [def, lo, hi, axis] of [
    [xDef, xLo, xHi, xAxis],
    [yDef, yLo, yHi, yAxis],
  ] as Array<[AxisDef, number, number, AxisKey]>) {
    if (def.field) {
      // year is integer; others are floats. Round for readability.
      const isInt = axis === 'year' || axis === 'votes';
      const loV = isInt ? Math.ceil(lo) : roundForAxis(lo, axis);
      const hiV = isInt ? Math.floor(hi) : roundForAxis(hi, axis);
      lines.push(`  ${def.field.min}: ${loV}`);
      lines.push(`  ${def.field.max}: ${hiV}`);
    } else {
      // ROI — emit a where: predicate.
      if (axis === 'roi') {
        wheres.push(
          `x.budget > 0 && x.revenue/x.budget >= ${lo.toFixed(2)} && x.revenue/x.budget < ${hi.toFixed(2)}`
        );
      }
    }
  }
  if (wheres.length > 0) {
    lines.push(`  where: x => ${wheres.join(' && ')}`);
  }
  return lines.join('\n');
}

function roundForAxis(v: number, axis: AxisKey): number | string {
  switch (axis) {
    case 'budget':
    case 'revenue':
      return Math.round(v);
    case 'rating':
      return +v.toFixed(2);
    case 'popularity':
      return +v.toFixed(1);
    case 'runtime':
      return Math.round(v);
    default:
      return +v.toFixed(2);
  }
}

// ---------------------------------------------------------------------------
// HTML rendering.
// ---------------------------------------------------------------------------

function renderGrid(g: GridOut): string {
  // Find min/max score for color scale; only positive scores get the warm
  // ramp, negatives get a muted grey so the "boring" cells fade.
  let smax = 0;
  for (const row of g.cells) for (const c of row) if (c.score > smax) smax = c.score;
  const cellHtml: string[] = [];
  // Render top-down (high y → low y) so "rating up" appears at top — the
  // natural reading order for a quality axis.
  for (let iy = g.bins - 1; iy >= 0; iy--) {
    cellHtml.push(`<div class="row">`);
    cellHtml.push(`<span class="ylab">${esc(g.y_labels[iy])}</span>`);
    for (let ix = 0; ix < g.bins; ix++) {
      const c = g.cells[iy][ix];
      const intensity =
        c.score > 0 ? Math.min(1, c.score / Math.max(smax, 1e-6)) : 0;
      const bg =
        c.score > 0
          ? `rgba(251, 146, 60, ${0.15 + 0.7 * intensity})`
          : `#15151b`;
      const lensVal = lensValueText(c, g.lens);
      const dim = c.n === 0 ? ' dim' : '';
      cellHtml.push(
        `<div class="cell${dim}" style="background:${bg}" title="n=${c.n} · score=${c.score.toFixed(2)} · ★${c.mean_rating.toFixed(2)} · ROI ${c.mean_roi.toFixed(1)}× · pop ${c.mean_popularity.toFixed(1)}">
  <span class="n">${c.n}</span>
  <span class="lv">${lensVal}</span>
</div>`
      );
    }
    cellHtml.push(`</div>`);
  }
  // x-axis labels row
  cellHtml.push(`<div class="row xax">`);
  cellHtml.push(`<span class="ylab"></span>`);
  for (let ix = 0; ix < g.bins; ix++)
    cellHtml.push(`<span class="xlab">${esc(g.x_labels[ix])}</span>`);
  cellHtml.push(`</div>`);
  return `<div class="grid" style="--bins:${g.bins}">${cellHtml.join('')}</div>`;
}

function lensValueText(c: Cell, lens: LensKey): string {
  if (c.n === 0) return '';
  switch (lens) {
    case 'density':
      return `${c.score >= 0 ? '+' : ''}${c.score.toFixed(1)}σ`;
    case 'rating':
      return `★${c.mean_rating.toFixed(1)}`;
    case 'roi':
      return `${c.mean_roi.toFixed(1)}×`;
    case 'popularity':
      return c.mean_popularity.toFixed(0);
  }
}

function renderRow(c: Candidate): string {
  const ex = c.exemplars
    .slice(0, 3)
    .map(e => `${esc(e.title)} (${e.year})`)
    .join(' · ');
  return `<article class="row">
  <header>
    <h2>${esc(c.name)}</h2>
    <span class="score">n=<b>${c.n}</b> · score <b>${c.score.toFixed(2)}</b></span>
  </header>
  <p class="stats">★ ${c.mean_rating.toFixed(2)} · ROI ${c.mean_roi.toFixed(2)}× · pop ${c.mean_popularity.toFixed(1)}</p>
  <p class="ex">${esc(ex)}</p>
  <pre class="yaml">${esc(c.yaml_spec)}</pre>
</article>`;
}

function fmtM(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

const esc = (v: unknown): string =>
  String(v == null ? '' : v).replace(
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

const STYLE = `<style>
.control .sr-compact { display:flex; flex-direction:column; gap:6px; }
.control .sr-compact strong { font-size:12px; color:#fb923c; }
.control .sr-compact p { margin:0; color:#9a9aa6; font-size:11px; font-variant-numeric:tabular-nums; }
.control .sr-compact p b { color:#c4b5fd; }
.control .sr-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }

.control .sr { display:flex; flex-direction:column; gap:10px; height:100%; color:#e7e7ea; font-size:11.5px; }
.control .sr .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .sr .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .sr .head .sub b { color:#c4b5fd; }
.control .sr .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }

.control .sr .grid { display:flex; flex-direction:column; gap:2px; padding:6px 0; }
.control .sr .grid .row { display:grid; grid-template-columns:80px repeat(var(--bins), 1fr); gap:2px; }
.control .sr .grid .row.xax { margin-top:2px; }
.control .sr .grid .ylab { color:#71717a; font-size:9.5px; text-align:right; align-self:center; padding-right:6px; font-variant-numeric:tabular-nums; }
.control .sr .grid .xlab { color:#71717a; font-size:9.5px; text-align:center; padding-top:2px; font-variant-numeric:tabular-nums; }
.control .sr .grid .cell { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:48px; border-radius:4px; border:1px solid #232329; padding:4px 2px; }
.control .sr .grid .cell.dim { opacity:0.35; }
.control .sr .grid .cell .n { font-size:13px; color:#e7e7ea; font-weight:600; font-variant-numeric:tabular-nums; line-height:1.1; }
.control .sr .grid .cell .lv { font-size:9.5px; color:#9a9aa6; font-variant-numeric:tabular-nums; margin-top:2px; }

.control .sr .rows { display:flex; flex-direction:column; gap:6px; overflow-y:auto; padding-right:6px; }
.control .sr .row { background:#15151b; border:1px solid #2a2a31; border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:4px; }
.control .sr .row header { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.control .sr .row header h2 { margin:0; font-size:12px; color:#c4b5fd; font-weight:600; }
.control .sr .row header .score { font-size:10.5px; color:#71717a; font-variant-numeric:tabular-nums; }
.control .sr .row header .score b { color:#fbbf24; }
.control .sr .row .stats { margin:0; color:#9a9aa6; font-size:10.5px; font-variant-numeric:tabular-nums; }
.control .sr .row .ex { margin:0; color:#a1a1aa; font-size:10.5px; }
.control .sr .row .yaml { margin:0; background:#0b0b0e; color:#86efac; padding:5px 7px; border-radius:4px; font-family:ui-monospace, Menlo, monospace; font-size:9.5px; line-height:1.4; user-select:all; white-space:pre; overflow-x:auto; }
</style>`;
