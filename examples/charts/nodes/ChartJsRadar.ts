import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Chart.js standout: a radar chart, where Chart.js is noticeably cleaner
 * than ECharts (smoother polygons, friendlier defaults, less config).
 * Shows per-category mean of six normalised metrics.
 */

interface Series { name: string; values: number[]; }
interface RadarInput { metrics: string[]; series: Series[]; }
interface RadarData { ready: boolean; metrics: string[]; series: Series[]; }

export const ChartJsRadar: CocoonProcessNode = {
  category: 'Charts',
  description: 'Chart.js — radar of per-category mean stats.',

  async *process(ctx) {
    const { radar } = ctx.ports.read() as { radar?: RadarInput };
    const ready = !!radar?.metrics?.length;
    ctx.ports.write({
      radarOut: ready
        ? { ready, metrics: radar!.metrics, series: radar!.series }
        : { ready: false, metrics: [], series: [] },
    });
    return ready ? `${radar!.metrics.length} metrics · ${radar!.series.length} series` : 'no radar';
  },

  control: {
    window: { width: 720, height: 580 },

    data(ctx): RadarData {
      return (ctx.output.radarOut as RadarData | undefined)
        ?? { ready: false, metrics: [], series: [] };
    },

    render(ctx) {
      const d = ctx.data as RadarData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="cj-compact">
  <strong>Radar</strong>
  <p>${d.ready ? `${d.series.length} series × ${d.metrics.length} axes` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="cj"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="cj">
  <header class="head">
    <h1>Mean metrics by category</h1>
    <p class="sub">${d.series.length} series · ${d.metrics.length} axes · 0..1 normalised</p>
  </header>
  <div class="plot" data-cocoon-hook="ChartJsRadar"><canvas></canvas></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface ChartInst { destroy(): void; update(): void; resize(): void; data: unknown; }
type ChartCtor = new (ctx: HTMLCanvasElement, cfg: unknown) => ChartInst;

const PALETTE = ['#8b5cf6', '#fbbf24', '#22d3ee', '#f97373', '#4ade80'];

export const hook: ControlHook<RadarData> = {
  mount(el, props) {
    const root = el.querySelector('.plot') ?? el;
    const canvas = (root.querySelector('canvas') ?? document.createElement('canvas')) as HTMLCanvasElement;
    if (!canvas.parentNode) root.appendChild(canvas);
    canvas.style.cssText = 'width:100%;height:100%;display:block;';

    let data = props.data;
    let chart: ChartInst | undefined;
    let Chart: ChartCtor | undefined;

    const draw = () => {
      if (!Chart || !data?.ready) return;
      chart?.destroy();
      // Chart.js mutates dataset objects with private metadata (`_meta`).
      // `props.data` arrives via Svelte's reactive controlData store; writing
      // through that proxy trips `state_descriptors_fixed`. JSON-clone to
      // detach (structuredClone can't handle Svelte's reactive proxies).
      const safe = JSON.parse(JSON.stringify({ metrics: data.metrics, series: data.series })) as RadarData;
      chart = new Chart(canvas, {
        type: 'radar',
        data: {
          labels: safe.metrics,
          datasets: safe.series.map((s, i) => ({
            label: s.name,
            data: s.values,
            backgroundColor: hexToRgba(PALETTE[i % PALETTE.length] as string, 0.18),
            borderColor: PALETTE[i % PALETTE.length],
            pointBackgroundColor: PALETTE[i % PALETTE.length],
            borderWidth: 2,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          color: '#e7e7ea',
          plugins: {
            legend: { labels: { color: '#e7e7ea', font: { size: 11 } } },
            tooltip: {
              backgroundColor: '#1a1a20',
              titleColor: '#fb923c',
              bodyColor: '#e7e7ea',
              borderColor: '#3c3c47',
              borderWidth: 1,
            },
          },
          scales: {
            r: {
              suggestedMin: 0, suggestedMax: 1,
              angleLines: { color: '#3c3c47' },
              grid: { color: '#27272a' },
              pointLabels: { color: '#c4b5fd', font: { size: 11 } },
              ticks: { color: '#71717a', backdropColor: 'transparent', font: { size: 9 } },
            },
          },
        },
      });
    };

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(root as HTMLElement);
    import('https://esm.sh/chart.js@4.4.6/auto')
      .then(m => { Chart = ((m as { default?: ChartCtor }).default ?? m) as ChartCtor; draw(); })
      .catch(err => { (root as HTMLElement).innerHTML = `<pre style="color:#f97373;padding:12px;">Chart.js failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); chart?.destroy(); },
    };
  },
};

const hexToRgba = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};

const STYLE = `<style>
.control .cj-compact { display:flex; flex-direction:column; gap:6px; }
.control .cj-compact strong { font-size:12px; color:#fb923c; }
.control .cj-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .cj-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .cj-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .cj { display:flex; flex-direction:column; gap:10px; height:100%; min-height:440px; color:#e7e7ea; font-size:11.5px; }
.control .cj .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .cj .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .cj .plot { flex:1; min-height:440px; position:relative; }
.control .cj .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
