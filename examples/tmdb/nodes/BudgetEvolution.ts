import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * The story. Buckets every enriched film into one of five budget tiers
 * (micro <$5M / low $5–20M / mid $20–60M / high $60–150M / tentpole
 * >$150M), counts films per tier per release year, normalises to shares,
 * and renders a stacked-area chart from `year_from` to `year_to`. On
 * first paint with the default inputs (1995–2024, US-origin, popularity-
 * sorted) the chart shows the tentpole tier emerging from a curiosity
 * into roughly a third of the catalogue, the bottom tiers collapsing,
 * and the mid tier hollowing out — Hollywood's escalating bet, visible
 * with zero interaction.
 *
 * No steering knobs here: the story shape is fixed, the controls live
 * upstream (DiscoverMovies) where they prune the candidate set. Free-form
 * viz only — no `event` handler, this is a "View" in the keystone-2
 * sense.
 *
 * Symmetric-import: a co-located `hook` ships to the browser, so this
 * file's top-level imports stay to `import type` + relative paths.
 * ECharts is dynamic-imported from a pinned CDN URL inside the hook
 * (the esbuild httpLoader plugin inlines it into the served bundle).
 */

interface EnrichedRow {
  id: number;
  release_year: number;
  budget: number;
  title: string;
}

interface BucketDef {
  key: string;
  label: string;
  min: number; // inclusive
  max: number; // exclusive (Infinity for the top)
  color: string;
}

// Ordered low → high; the colour ramp tracks the story (cool = small,
// warm = large), so reading the chart bottom-to-top is reading the
// "more money" gradient.
const BUCKETS: BucketDef[] = [
  { key: 'micro', label: 'Micro (<$5M)', min: 0, max: 5e6, color: '#1e3a8a' },
  { key: 'low', label: 'Low ($5–20M)', min: 5e6, max: 20e6, color: '#3b82f6' },
  { key: 'mid', label: 'Mid ($20–60M)', min: 20e6, max: 60e6, color: '#a3a3a3' },
  { key: 'high', label: 'High ($60–150M)', min: 60e6, max: 150e6, color: '#f97316' },
  { key: 'tent', label: 'Tentpole (>$150M)', min: 150e6, max: Infinity, color: '#dc2626' },
];

function bucketOf(budget: number): string | null {
  if (!Number.isFinite(budget) || budget <= 0) return null;
  for (const b of BUCKETS) if (budget >= b.min && budget < b.max) return b.key;
  return null;
}

interface YearRow {
  year: number;
  n: number; // films with a known positive budget
  shares: Record<string, number>; // per-bucket fraction summing to ~1
}

interface ChartPayload {
  ready: boolean;
  years: YearRow[];
  buckets: Array<Pick<BucketDef, 'key' | 'label' | 'color'>>;
  totalWithBudget: number;
  totalRows: number;
  tentpoleFirst: { year: number; share: number } | null;
  tentpoleLast: { year: number; share: number } | null;
}

export const BudgetEvolution: CocoonProcessNode = {
  category: 'TMDB',
  description: 'Per-year budget-tier share — Hollywood\'s escalating bet.',

  control: {
    window: { width: 880, height: 560 },
    data(ctx): ChartPayload {
      return (
        (ctx.output.chart as ChartPayload | undefined) ?? {
          ready: false,
          years: [],
          buckets: [],
          totalWithBudget: 0,
          totalRows: 0,
          tentpoleFirst: null,
          tentpoleLast: null,
        }
      );
    },
    render(ctx) {
      const d = (ctx.data as ChartPayload) ?? { ready: false };
      const compact = ctx.surface === 'node';
      if (!d.ready) {
        return compact
          ? `${STYLE}<div class="bev-compact"><strong>Budget evolution</strong><p>upstream not ready</p>
  <button data-cocoon-event="$open">Open chart ▸</button></div>`
          : `${STYLE}<div class="bev"><p class="empty">Pull EnrichMovies upstream first.</p></div>`;
      }
      const tentDelta =
        d.tentpoleLast && d.tentpoleFirst
          ? `${(d.tentpoleFirst.share * 100).toFixed(0)}% → ${(d.tentpoleLast.share * 100).toFixed(0)}%`
          : '—';
      if (compact) {
        return `${STYLE}<div class="bev-compact">
  <strong>Hollywood's escalating bet</strong>
  <p>${d.years.length} years · ${d.totalWithBudget}/${d.totalRows} films w/ budget</p>
  <p class="hi">Tentpole share: <b>${tentDelta}</b></p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      const span =
        d.years.length > 0
          ? `${d.years[0].year}–${d.years[d.years.length - 1].year}`
          : '—';
      return `${STYLE}<div class="bev">
  <header class="head">
    <h1>Hollywood's escalating bet</h1>
    <p class="sub">${span} · ${d.totalWithBudget} US-released films with disclosed budget · tentpole (>$150M) share moved <b>${tentDelta}</b></p>
  </header>
  <div class="plot" data-cocoon-hook="BudgetEvolution"></div>
  <p class="foot">Films grouped by inflation-unadjusted production budget. Bottom (cool) to top (warm) is small → large. Source: TMDB /discover ranked by popularity, US origin.</p>
</div>`;
    },
  },

  async *process(ctx) {
    const { movies } = ctx.ports.read() as { movies?: EnrichedRow[] };
    const rows = Array.isArray(movies) ? movies : [];

    type Acc = { n: number; counts: Record<string, number> };
    const byYear = new Map<number, Acc>();
    let totalWithBudget = 0;
    for (const r of rows) {
      const b = bucketOf(r.budget);
      if (b == null) continue;
      const y = r.release_year;
      if (!Number.isFinite(y) || y <= 0) continue;
      let acc = byYear.get(y);
      if (!acc) {
        acc = { n: 0, counts: Object.fromEntries(BUCKETS.map(x => [x.key, 0])) };
        byYear.set(y, acc);
      }
      acc.n++;
      acc.counts[b]++;
      totalWithBudget++;
    }

    const years: YearRow[] = [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, acc]) => ({
        year,
        n: acc.n,
        shares: Object.fromEntries(
          BUCKETS.map(b => [b.key, acc.n > 0 ? acc.counts[b.key] / acc.n : 0])
        ),
      }));

    // Headline endpoints — first and last year's tentpole share. The
    // delta is the one number the title/sub/compact preview all quote.
    const tentpoleFirst =
      years.length > 0
        ? { year: years[0].year, share: years[0].shares.tent }
        : null;
    const tentpoleLast =
      years.length > 0
        ? {
            year: years[years.length - 1].year,
            share: years[years.length - 1].shares.tent,
          }
        : null;

    const chart: ChartPayload = {
      ready: years.length > 0,
      years,
      buckets: BUCKETS.map(b => ({ key: b.key, label: b.label, color: b.color })),
      totalWithBudget,
      totalRows: rows.length,
      tentpoleFirst,
      tentpoleLast,
    };
    ctx.ports.write({ movies: rows, chart });

    const headline =
      tentpoleFirst && tentpoleLast
        ? `tentpole share ${tentpoleFirst.year}: ${(tentpoleFirst.share * 100).toFixed(0)}% → ${tentpoleLast.year}: ${(tentpoleLast.share * 100).toFixed(0)}%`
        : 'no budget data';
    return `${years.length} years · ${totalWithBudget} films · ${headline}`;
  },
};

// ---------------------------------------------------------------------------
// Browser hook — ECharts stacked area chart via pinned CDN URL.
// ---------------------------------------------------------------------------

interface EChartsInst {
  setOption: (o: unknown) => void;
  resize: () => void;
  dispose: () => void;
}
interface EChartsMod {
  init: (el: HTMLElement, theme?: string) => EChartsInst;
}

export const hook: ControlHook<ChartPayload> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:340px;';
    el.appendChild(root);

    let data = props.data;
    let chart: EChartsInst | undefined;
    let echarts: EChartsMod | undefined;

    const draw = () => {
      if (!echarts || !data?.ready || data.years.length === 0) return;
      if (!chart) chart = echarts.init(root, 'dark');

      const years = data.years.map(y => y.year);
      const series = data.buckets.map(b => ({
        name: b.label,
        type: 'line',
        stack: 'share',
        areaStyle: { opacity: 0.92 },
        lineStyle: { width: 0 },
        symbol: 'none',
        smooth: 0.25,
        itemStyle: { color: b.color },
        emphasis: { focus: 'series' },
        data: data!.years.map(y => +(y.shares[b.key] * 100).toFixed(2)),
      }));

      chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 56, right: 24, top: 40, bottom: 50, containLabel: false },
        legend: {
          top: 6,
          textStyle: { color: '#9a9aa6', fontSize: 11 },
          itemWidth: 14,
          itemHeight: 10,
        },
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#1a1a20',
          borderColor: '#3c3c47',
          textStyle: { color: '#e7e7ea', fontSize: 11 },
          formatter: (
            params: Array<{ axisValue: number; seriesName: string; value: number; color: string }>
          ) => {
            const y = params[0]?.axisValue;
            const yr = data!.years.find(r => r.year === Number(y));
            const head = `<b style="color:#fb923c">${y}</b> · n=${yr?.n ?? 0}<br/>`;
            const reversed = [...params].reverse();
            return (
              head +
              reversed
                .map(
                  p =>
                    `<span style="display:inline-block;width:9px;height:9px;background:${p.color};margin-right:6px;border-radius:1px;"></span>${p.seriesName}: <b>${p.value.toFixed(1)}%</b>`
                )
                .join('<br/>')
            );
          },
        },
        xAxis: {
          type: 'category',
          data: years,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#3c3c47' } },
          axisLabel: { color: '#9a9aa6', fontSize: 10 },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: { color: '#9a9aa6', fontSize: 10, formatter: '{value}%' },
          axisLine: { lineStyle: { color: '#3c3c47' } },
          splitLine: { lineStyle: { color: '#27272a' } },
        },
        series,
      });
      chart.resize();
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
        data = (next.data as ChartPayload) ?? data;
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

const STYLE = `<style>
.control .bev-compact { display:flex; flex-direction:column; gap:6px; }
.control .bev-compact strong { font-size:12px; color:#fb923c; }
.control .bev-compact p { margin:0; color:#9a9aa6; font-size:11px; font-variant-numeric:tabular-nums; }
.control .bev-compact p.hi b { color:#c4b5fd; }
.control .bev-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .bev-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .bev { display:flex; flex-direction:column; gap:10px; height:100%; min-height:420px; color:#e7e7ea; font-size:11.5px; }
.control .bev .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .bev .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .bev .head .sub b { color:#c4b5fd; }
.control .bev .plot { flex:1; min-height:380px; }
.control .bev .foot { margin:0; color:#71717a; font-size:10px; line-height:1.5; }
.control .bev .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
