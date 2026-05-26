import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * uPlot standout: 1M-point timeseries at 60fps. The whole reason to pick
 * uPlot over ECharts/Chart.js is throughput; this demo earns its keep by
 * actually drawing a million points.
 *
 * The wire payload stays small: SeedData emits a config (`{ n, seed }`)
 * and the hook generates the points client-side in a typed array. The
 * pattern generalises — a streaming/aggregating upstream + a hook-side
 * dense draw — and avoids shipping huge JSON across the socket.
 */

interface Config { n: number; seed: number; label: string; }
interface MillionData { ready: boolean; n: number; seed: number; label: string; }

export const UPlotMillion: CocoonProcessNode = {
  category: 'Charts',
  description: 'uPlot — 1M-point timeseries (hook-generated; demonstrates throughput).',

  async *process(ctx) {
    const { config } = ctx.ports.read() as { config?: Config };
    const n = config?.n ?? 1_000_000;
    const seed = config?.seed ?? 42;
    const label = config?.label ?? `${n.toLocaleString()} points`;
    ctx.ports.write({ million: { ready: true, n, seed, label } });
    return label;
  },

  control: {
    window: { width: 980, height: 520 },

    data(ctx): MillionData {
      return (ctx.output.million as MillionData | undefined)
        ?? { ready: false, n: 0, seed: 0, label: '' };
    },

    render(ctx) {
      const d = ctx.data as MillionData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="up-compact">
  <strong>uPlot · ${d.label || '—'}</strong>
  <p>${d.ready ? 'drag to zoom · dbl-click to reset' : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="up"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="up">
  <header class="head">
    <h1>${d.label} · uPlot</h1>
    <p class="sub">drag-to-zoom (both axes) · shift-drag-to-pan · dbl-click to reset</p>
  </header>
  <div class="plot" data-cocoon-hook="UPlotMillion"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface UPlotInst { setData(d: number[][]): void; setSize(s: { width: number; height: number }): void; destroy(): void; }
type UPlotCtor = new (opts: unknown, data: number[][] | Float64Array[], target: HTMLElement) => UPlotInst;

const CSS_URL = 'https://esm.sh/uplot@1.6.31/dist/uPlot.min.css';

export const hook: ControlHook<MillionData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:380px;position:relative;';
    el.appendChild(root);

    // Inject uPlot CSS once (idempotent — same href won't add twice).
    if (!document.head.querySelector(`link[href="${CSS_URL}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_URL;
      document.head.appendChild(link);
    }

    let data = props.data;
    let chart: UPlotInst | undefined;
    let UPlot: UPlotCtor | undefined;

    const generate = (n: number, seed: number): Float64Array[] => {
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      // Simple deterministic walk so the demo always looks similar.
      let s = seed;
      let v = 0;
      const noise = () => {
        s = (s * 16807) % 2147483647;
        return (s / 2147483647 - 0.5);
      };
      for (let i = 0; i < n; i++) {
        xs[i] = i;
        // Walk + sine + a couple of regime shifts so the curve has shape.
        v += noise() * 0.6;
        const sine = Math.sin(i / 30000) * 12 + Math.sin(i / 4500) * 4;
        ys[i] = v + sine + (i > n * 0.5 ? 8 : 0);
      }
      return [xs, ys];
    };

    const draw = () => {
      if (!UPlot || !data?.ready) return;
      chart?.destroy();
      chart = undefined;
      const t0 = performance.now();
      const series = generate(data.n, data.seed);
      const w = root.clientWidth || 900;
      // uPlot renders its legend BELOW the canvas; reserve ~38px so it
      // doesn't clip against the flex container's bottom edge.
      const LEGEND_PX = 38;
      const h = Math.max(120, (root.clientHeight || 380) - LEGEND_PX);
      chart = new UPlot({
        width: w, height: h,
        scales: { x: { time: false } },
        axes: [
          { stroke: '#9a9aa6', grid: { stroke: '#27272a', width: 1 } },
          { stroke: '#9a9aa6', grid: { stroke: '#27272a', width: 1 } },
        ],
        series: [
          { label: 'i' },
          { label: 'value', stroke: '#8b5cf6', width: 1, points: { show: false } },
        ],
        cursor: { drag: { x: true, y: true, uni: 50 } },
      }, series as unknown as number[][], root);
      const ms = (performance.now() - t0).toFixed(0);
      const info = document.createElement('div');
      info.className = 'up-info';
      info.textContent = `${data.n.toLocaleString()} pts · drew in ${ms}ms`;
      root.appendChild(info);
    };

    const ro = new ResizeObserver(() => {
      if (chart) chart.setSize({
        width: root.clientWidth,
        height: Math.max(120, root.clientHeight - 38),
      });
    });
    ro.observe(root);
    import('https://esm.sh/uplot@1.6.31')
      .then(m => { UPlot = ((m as { default?: UPlotCtor }).default ?? m) as UPlotCtor; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">uPlot failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); chart?.destroy(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .up-compact { display:flex; flex-direction:column; gap:6px; }
.control .up-compact strong { font-size:12px; color:#fb923c; }
.control .up-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .up-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .up-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .up { display:flex; flex-direction:column; gap:10px; height:100%; min-height:380px; color:#e7e7ea; font-size:11.5px; }
.control .up .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .up .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .up .plot { flex:1; min-height:380px; position:relative; }
.control .up .plot .up-info { position:absolute; top:6px; right:10px; color:#9a9aa6; font-size:10.5px; background:rgba(28,28,32,0.85); padding:2px 6px; border-radius:4px; font-variant-numeric:tabular-nums; }
.control .up .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
.control .up .uplot { color:#e7e7ea; }
.control .up .u-legend { color:#c4b5fd; }
</style>`;
