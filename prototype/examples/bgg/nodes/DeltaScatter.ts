import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * The visual answer to the question — a scatterplot of every game's
 * rating delta against a steering-selected dimension, with a least-
 * squares trendline and a zero-delta reference baseline.
 *
 * Both control tiers in one node (keystone 5, mirroring RatingHistogram
 * in `sandbox/rate`):
 *   - **steering**: `dimension` and `highlight` are simple inline knobs.
 *     They steer the emitted view payload, so they belong in `process()` —
 *     set one → node goes `stale` → re-pull. The pull is the commit.
 *   - **free-form viz**: `control.data` + `control.render` + `hook` is
 *     the action tier's `data → HTML → ECharts` chain. The hook lazy-
 *     loads ECharts from a pinned CDN URL (keystone 1: a hook can
 *     depend on a CDN dep, declared at the call site).
 *
 * The hook deliberately does NOT post `controlEvent`s — brushing back
 * into the upstream pipeline is the "selectedRanges" deferred work
 * (CLAUDE.md). For now it's a pure visualisation.
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
  thumbnail?: string;
  [k: string]: unknown;
}

// Complexity (`weight`) only lives in /xmlapi2/thing (auth-gated). Re-add
// once enrichment is back.
const DIM_LABELS: Record<string, { label: string; unit: string }> = {
  year: { label: 'Release year', unit: '' },
  playing_time: { label: 'Playing time', unit: 'min' },
  min_players: { label: 'Min players', unit: '' },
  max_players: { label: 'Max players', unit: '' },
  num_ratings: { label: 'Popularity (# voters)', unit: '' },
};

interface Point {
  id: string;
  name: string;
  x: number;
  y: number;
  outlier: boolean;
}

interface ScatterData {
  ready: boolean;
  dimension: string;
  dimLabel: string;
  dimUnit: string;
  points: Point[];
  trend: { slope: number; intercept: number; r: number };
  n: number;
}

export const DeltaScatter: CocoonProcessNode = {
  category: 'BGG',
  description: 'Scatter delta vs a chosen game dimension (ECharts hook).',

  controls: {
    dimension: {
      kind: 'select',
      label: 'x axis',
      options: Object.keys(DIM_LABELS),
      default: 'year',
    },
    highlight: {
      kind: 'number',
      label: 'highlight ±N outliers',
      default: 5,
      min: 0,
      max: 50,
      step: 1,
    },
  },

  async *process(ctx) {
    const { games } = ctx.ports.read() as { games?: Row[] };
    const { dimension, highlight } = ctx.controls.read() as {
      dimension: string;
      highlight: number;
    };
    const rows = Array.isArray(games) ? games : [];

    const dim = DIM_LABELS[dimension] ?? DIM_LABELS.year;
    const points: Point[] = [];
    for (const r of rows) {
      const x = Number(r[dimension as keyof Row]);
      const y = Number(r.delta);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) continue;
      points.push({ id: r.id, name: r.name, x, y, outlier: false });
    }

    // Mark the N largest |delta| points as outliers (visual highlight).
    const sorted = [...points].sort((a, b) => Math.abs(b.y) - Math.abs(a.y));
    const cut = Math.min(highlight, sorted.length);
    const flag = new Set(sorted.slice(0, cut).map(p => p.id));
    for (const p of points) p.outlier = flag.has(p.id);

    const trend = linreg(points);

    const out: ScatterData = {
      ready: points.length > 0,
      dimension,
      dimLabel: dim.label,
      dimUnit: dim.unit,
      points,
      trend,
      n: points.length,
    };
    ctx.ports.write({ scatter: out });
    return `${points.length} points · slope ${trend.slope.toFixed(3)} · r=${trend.r.toFixed(3)}`;
  },

  control: {
    window: { width: 720, height: 560 },

    data(ctx): ScatterData {
      const s = ctx.output.scatter as ScatterData | undefined;
      return s ?? {
        ready: false,
        dimension: '',
        dimLabel: '',
        dimUnit: '',
        points: [],
        trend: { slope: 0, intercept: 0, r: 0 },
        n: 0,
      };
    },

    render(ctx) {
      const d = (ctx.data as ScatterData) ?? { ready: false };
      const compact = ctx.surface === 'node';

      if (!d.ready) {
        return compact
          ? `${STYLE}<div class="scatter-compact"><strong>Scatter</strong><p>change a knob and ▶ re-run</p>
  <button data-cocoon-event="$open">Open chart ▸</button></div>`
          : `${STYLE}<div class="scatter"><p class="empty">No points — pull ComputeDeltas upstream and re-run.</p></div>`;
      }

      if (compact) {
        return `${STYLE}<div class="scatter-compact">
  <strong>Δ vs ${esc(d.dimLabel)}</strong>
  <p>n=${d.n} · slope ${fmt(d.trend.slope, 3)} · r=${fmt(d.trend.r, 3)}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }

      return `${STYLE}<div class="scatter">
  <header class="head">
    <h1>Δ vs ${esc(d.dimLabel)}</h1>
    <p class="sub">${d.n} games · slope <b>${fmt(d.trend.slope, 3)}</b>${d.dimUnit ? ` per ${d.dimUnit}` : ''} · Pearson r=<b>${fmt(d.trend.r, 3)}</b></p>
  </header>
  <div class="plot" data-cocoon-hook="DeltaScatter"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------
// Browser hook — ECharts via pinned CDN URL (keystone 1).
// ---------------------------------------------------------------------------

interface EChartsInst {
  setOption: (o: unknown) => void;
  resize: () => void;
  dispose: () => void;
}
interface EChartsMod {
  init: (el: HTMLElement, theme?: string) => EChartsInst;
}

export const hook: ControlHook<ScatterData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:340px;';
    el.appendChild(root);

    let data = props.data;
    let chart: EChartsInst | undefined;
    let echarts: EChartsMod | undefined;

    const draw = () => {
      if (!echarts || !data?.ready) return;
      if (!chart) chart = echarts.init(root, 'dark');

      const reg = data.points.map(p => [p.x, p.y]);
      const reg_lo = Math.min(...data.points.map(p => p.x));
      const reg_hi = Math.max(...data.points.map(p => p.x));
      const trendLine = [
        [reg_lo, data.trend.intercept + data.trend.slope * reg_lo],
        [reg_hi, data.trend.intercept + data.trend.slope * reg_hi],
      ];

      const normal = data.points.filter(p => !p.outlier);
      const outliers = data.points.filter(p => p.outlier);

      chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 56, right: 24, top: 30, bottom: 44, containLabel: false },
        tooltip: {
          trigger: 'item',
          backgroundColor: '#1a1a20',
          borderColor: '#3c3c47',
          textStyle: { color: '#e7e7ea', fontSize: 11 },
          formatter: (p: { data: number[]; dataIndex: number; seriesName: string }) => {
            const series = p.seriesName === 'outliers' ? outliers : normal;
            const point = series[p.dataIndex];
            if (!point) return '';
            const sign = point.y >= 0 ? '+' : '';
            return `<b style="color:#fb923c">${esc(point.name)}</b><br/>` +
              `x = ${fmt(point.x, 2)}${data!.dimUnit ? ` ${data!.dimUnit}` : ''}<br/>` +
              `Δ = <b>${sign}${fmt(point.y, 2)}</b>`;
          },
        },
        xAxis: {
          name: data.dimLabel,
          nameLocation: 'middle',
          nameGap: 28,
          nameTextStyle: { color: '#9a9aa6', fontSize: 11 },
          axisLine: { lineStyle: { color: '#3c3c47' } },
          axisLabel: { color: '#9a9aa6', fontSize: 10 },
          splitLine: { lineStyle: { color: '#27272a' } },
        },
        yAxis: {
          name: 'Δ rating (own − community)',
          nameLocation: 'middle',
          nameGap: 44,
          nameTextStyle: { color: '#9a9aa6', fontSize: 11 },
          axisLine: { lineStyle: { color: '#3c3c47' } },
          axisLabel: { color: '#9a9aa6', fontSize: 10 },
          splitLine: { lineStyle: { color: '#27272a' } },
        },
        series: [
          {
            name: 'zero',
            type: 'line',
            showSymbol: false,
            data: [[reg_lo, 0], [reg_hi, 0]],
            lineStyle: { color: '#52525b', type: 'dashed', width: 1 },
            silent: true,
            z: 1,
          },
          {
            name: 'trend',
            type: 'line',
            showSymbol: false,
            data: trendLine,
            lineStyle: { color: '#8b5cf6', width: 2 },
            silent: true,
            z: 2,
          },
          {
            name: 'games',
            type: 'scatter',
            symbolSize: 7,
            itemStyle: { color: '#fbbf24', opacity: 0.75 },
            data: normal.map(p => [p.x, p.y]),
            z: 3,
          },
          {
            name: 'outliers',
            type: 'scatter',
            symbolSize: 11,
            itemStyle: { color: '#f97373', borderColor: '#fff', borderWidth: 1 },
            data: outliers.map(p => [p.x, p.y]),
            label: {
              show: true,
              position: 'top',
              color: '#e7e7ea',
              fontSize: 10,
              formatter: (p: { dataIndex: number }) =>
                truncate(outliers[p.dataIndex]?.name ?? '', 22),
            },
            z: 4,
          },
        ],
      });
      chart.resize();
      void reg; // silence unused
    };

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(root);

    import('https://esm.sh/echarts@5.4.3')
      .then(m => {
        echarts = m as unknown as EChartsMod;
        draw();
      })
      .catch(err => {
        root.innerHTML = `<pre style="color:#f97373;padding:12px;">ECharts failed to load: ${String(err)}</pre>`;
      });

    return {
      update(next) {
        data = (next.data as ScatterData) ?? data;
        draw();
      },
      destroy() {
        ro.disconnect();
        chart?.dispose();
        root.remove();
      },
    };
  },
};

// ---------------------------------------------------------------------------

function linreg(pts: Point[]): { slope: number; intercept: number; r: number } {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: 0, r: 0 };
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r: 0 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r };
}

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
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
const truncate = (s: string, n: number) =>
  s.length <= n ? s : s.slice(0, n - 1) + '…';

// ---------------------------------------------------------------------------

const STYLE = `<style>
.control .scatter-compact { display:flex; flex-direction:column; gap:6px; }
.control .scatter-compact strong { font-size:12px; color:#fb923c; }
.control .scatter-compact p { margin:0; color:#9a9aa6; font-size:11px; font-variant-numeric:tabular-nums; }
.control .scatter-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .scatter-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .scatter { display:flex; flex-direction:column; gap:10px; height:100%; min-height:380px; color:#e7e7ea; font-size:11.5px; }
.control .scatter .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .scatter .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .scatter .head .sub b { color:#c4b5fd; }
.control .scatter .plot { flex:1; min-height:340px; }
.control .scatter .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
