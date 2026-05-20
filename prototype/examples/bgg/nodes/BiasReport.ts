import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * The headline — a render-only free-form control (no `event`), the
 * sharpest demonstration of keystone 2 (a "view" is just a control
 * without an event handler). Computes a simple-OLS slope of
 * `delta` against each game dimension and turns the signs/magnitudes
 * into a short narrative line.
 *
 * Pure derivation, all on the frozen pull output — change a steering
 * knob upstream, re-pull there, the report re-derives without anyone
 * re-running this node. (The slope is a fact about the data, not about
 * presentation, so the heavy lifting could equally live in `process()`;
 * here it sits in `control.data()` because the *whole node* is the
 * narrative-and-table view and there's no downstream consumer of the
 * coefficients table.)
 */

interface Row {
  id: string;
  name: string;
  delta: number;
  weight?: number;
  year?: number | null;
  playing_time?: number | null;
  min_players?: number | null;
  max_players?: number | null;
  num_ratings: number;
  num_owned?: number;
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

interface DimResult {
  key: string;
  label: string;
  unit: string;
  n: number;
  slope: number; // Δ per +1 unit of dim
  r: number; // Pearson correlation
  meanX: number;
  verdict: string;
}

interface ReportData {
  ready: boolean;
  summary?: Summary;
  dims?: DimResult[];
  headline?: string;
}

// Complexity (`weight`) is the obvious sixth dimension; it only lives in
// /xmlapi2/thing, which requires an app token even when logged in. Re-add
// here once enrichment is wired back in.
const DIMS: { key: keyof Row; label: string; unit: string }[] = [
  { key: 'year', label: 'Release year', unit: 'year' },
  { key: 'playing_time', label: 'Playing time', unit: 'min' },
  { key: 'min_players', label: 'Min players', unit: '' },
  { key: 'max_players', label: 'Max players', unit: '' },
  { key: 'num_ratings', label: 'Popularity', unit: 'voters' },
];

export const BiasReport: CocoonProcessNode = {
  category: 'BGG',
  description: 'Linear bias of the user\'s rating delta vs each dimension.',

  async *process(ctx) {
    // The node's `process` is a thin pass-through; the analysis lives in
    // `control.data()` (it has no downstream consumer). The pull is what
    // commits the upstream steering — the report watches `ctx.output`.
    const { games, summary } = ctx.ports.read() as {
      games?: Row[];
      summary?: Summary;
    };
    ctx.ports.write({ games: games ?? [], summary: summary ?? null });
    return summary ? `n=${summary.n} · mean Δ ${summary.mean_delta}` : 'idle';
  },

  control: {
    window: { width: 560, height: 600 },

    data(ctx): ReportData {
      const games = (ctx.output.games as Row[] | undefined) ?? [];
      const summary = ctx.output.summary as Summary | undefined;
      if (games.length === 0 || !summary) return { ready: false };

      const dims = DIMS.map(d => analyse(games, d.key, d.label, d.unit)).filter(
        r => r.n >= 10
      );
      return {
        ready: true,
        summary,
        dims,
        headline: buildHeadline(summary, dims),
      };
    },

    render(ctx) {
      const d = (ctx.data as ReportData) ?? { ready: false };
      const compact = ctx.surface === 'node';

      if (!d.ready) {
        return compact
          ? `${STYLE}<div class="bias-compact"><strong>Bias</strong><p>pull upstream to build the report</p>
  <button data-cocoon-event="$open">Open report ▸</button></div>`
          : `${STYLE}<div class="bias"><p class="empty">No deltas yet — run ComputeDeltas upstream.</p></div>`;
      }

      const s = d.summary!;
      const sign = s.mean_delta >= 0 ? '+' : '';
      const tilt =
        Math.abs(s.mean_delta) < 0.1
          ? 'in line with'
          : s.mean_delta > 0
            ? 'more generous than'
            : 'harsher than';

      if (compact) {
        const top = [...d.dims!].sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))[0];
        return `${STYLE}<div class="bias-compact">
  <strong>Bias report</strong>
  <p>n=${s.n} · mean Δ <em>${sign}${s.mean_delta}</em> (${tilt} community)</p>
  ${top ? `<p class="lede">Strongest pull: <b>${esc(top.label)}</b> · ${slopeFmt(top.slope, top.unit)}</p>` : ''}
  <button data-cocoon-event="$open">Open report ▸</button>
</div>`;
      }

      const rows = d
        .dims!.map(
          r => `<tr>
  <td class="dim">${esc(r.label)}</td>
  <td class="num">${r.n}</td>
  <td class="num"><b class="${r.slope > 0 ? 'pos' : r.slope < 0 ? 'neg' : ''}">${slopeFmt(r.slope, r.unit)}</b></td>
  <td class="num">${fmt(r.r, 3)}</td>
  <td class="verdict">${esc(r.verdict)}</td>
</tr>`
        )
        .join('');

      return `${STYLE}<div class="bias">
  <header class="head">
    <h1>Rating bias against the community</h1>
    <p class="sub">Comparing the user's rating to the <b>${s.benchmark}</b> across <b>${s.n}</b> games.</p>
  </header>

  <section class="card">
    <h2>Headline</h2>
    <p class="headline">${esc(d.headline ?? '')}</p>
    <table class="kv">
      <tr><th>Mean own rating</th><td>${fmt(s.mean_own, 2)}</td></tr>
      <tr><th>Mean community ${s.benchmark}</th><td>${fmt(s.mean_community, 2)}</td></tr>
      <tr><th>Mean Δ</th><td><b class="${s.mean_delta > 0 ? 'pos' : s.mean_delta < 0 ? 'neg' : ''}">${sign}${fmt(s.mean_delta, 3)}</b></td></tr>
      <tr><th>Median Δ</th><td>${fmt(s.median_delta, 3)}</td></tr>
      <tr><th>σ(Δ)</th><td>${fmt(s.stddev_delta, 3)}</td></tr>
    </table>
  </section>

  <section class="card">
    <h2>Linear bias per dimension</h2>
    <p class="hint">Slope = how much the rating deviation moves per +1 unit of the dimension. Pearson <i>r</i> in [−1,1].</p>
    <table class="slopes">
      <thead><tr><th>Dimension</th><th>n</th><th>Δ per unit</th><th>r</th><th>Reads as</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function analyse(
  rows: Row[],
  key: keyof Row,
  label: string,
  unit: string
): DimResult {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rows) {
    const x = Number(r[key]);
    const y = Number(r.delta);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 2)
    return {
      key: String(key),
      label,
      unit,
      n,
      slope: 0,
      r: 0,
      meanX: 0,
      verdict: 'not enough data',
    };

  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r = sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return {
    key: String(key),
    label,
    unit,
    n,
    slope: round3(slope),
    r: round3(r),
    meanX: round3(mx),
    verdict: verdict(label, slope, r),
  };
}

function verdict(label: string, slope: number, r: number): string {
  const mag = Math.abs(r);
  if (mag < 0.08) return 'no clear bias';
  const strong = mag >= 0.25 ? 'strongly' : mag >= 0.15 ? 'noticeably' : 'mildly';
  const dir = slope > 0 ? 'rewards' : 'penalises';
  const what = label.toLowerCase();
  return `${strong} ${dir} ${what}`;
}

function buildHeadline(s: Summary, dims: DimResult[]): string {
  const ranked = [...dims]
    .filter(d => Math.abs(d.r) >= 0.08)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, 3);
  const sign = s.mean_delta >= 0 ? '+' : '';
  const tilt =
    Math.abs(s.mean_delta) < 0.1
      ? 'rates roughly in line with the community'
      : s.mean_delta > 0
        ? `rates ${sign}${s.mean_delta} above the community on average`
        : `rates ${s.mean_delta} below the community on average`;
  if (ranked.length === 0) return `The user ${tilt}, with no strong directional bias on any dimension.`;
  const tails = ranked.map(d => d.verdict).join(', ');
  return `The user ${tilt}, and ${tails}.`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const slopeFmt = (slope: number, unit: string): string => {
  const s = slope >= 0 ? '+' : '';
  const u = unit ? ` / ${unit}` : '';
  return `${s}${slope.toFixed(3)}${u}`;
};
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

// ---------------------------------------------------------------------------

const STYLE = `<style>
.control .bias-compact { display:flex; flex-direction:column; gap:6px; }
.control .bias-compact strong { font-size:12px; color:#fb923c; }
.control .bias-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .bias-compact em { color:#fbbf24; font-style:normal; }
.control .bias-compact .lede b { color:#c4b5fd; }
.control .bias-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .bias-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .bias {
  --card:#212128; --line:#303039; --muted:#9a9aa6; --pos:#22d3ee; --neg:#f97373;
  display:flex; flex-direction:column; gap:16px; color:#e7e7ea; font-size:11.5px; line-height:1.5;
}
.control .bias .head h1 { margin:0 0 4px 0; font-size:16px; color:#fb923c; }
.control .bias .head .sub { margin:0; color:var(--muted); font-size:11.5px; }
.control .bias .head b { color:#e7e7ea; }
.control .bias .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.control .bias .card h2 { margin:0; font-size:9.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.control .bias .headline { margin:0; font-size:13px; color:#fbbf24; }
.control .bias .hint { margin:0; color:var(--muted); font-size:10.5px; font-style:italic; }
.control .bias table { border-collapse:separate; border-spacing:0; width:100%; font-size:11.5px; }
.control .bias table.kv th { text-align:left; color:var(--muted); font-weight:500; padding:3px 0; }
.control .bias table.kv td { text-align:right; color:#e7e7ea; padding:3px 0; font-variant-numeric:tabular-nums; }
.control .bias table.slopes th { color:var(--muted); font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; padding:6px 8px; text-align:left; border-bottom:1px solid var(--line); }
.control .bias table.slopes td { padding:6px 8px; border-bottom:1px solid #2a2a31; }
.control .bias table.slopes td.num { text-align:right; font-variant-numeric:tabular-nums; }
.control .bias table.slopes td.dim { color:#a5b4fc; }
.control .bias table.slopes td.verdict { color:var(--muted); font-style:italic; }
.control .bias b.pos { color:var(--pos); }
.control .bias b.neg { color:var(--neg); }
</style>`;
