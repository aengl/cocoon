import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Plotly standout: 3D surface. The one common chart no other library
 * here does at all. Renders a synthetic "rating landscape" over the
 * (weight, year) plane with Plotly's built-in modebar (rotate, pan,
 * zoom, reset, save-png) and a continuous colourscale.
 */

interface SurfaceInput { z: number[][]; xLabels: string[]; yLabels: string[]; }
interface SurfaceData { ready: boolean; z: number[][]; x: string[]; y: string[]; }

export const PlotlySurface: CocoonProcessNode = {
  category: 'Charts',
  description: 'Plotly — 3D surface (rating landscape over weight × year).',

  async *process(ctx) {
    const { surface } = ctx.ports.read() as { surface?: SurfaceInput };
    const ready = !!surface?.z?.length;
    ctx.ports.write({
      surfaceOut: ready
        ? { ready, z: surface!.z, x: surface!.xLabels, y: surface!.yLabels }
        : { ready: false, z: [], x: [], y: [] },
    });
    return ready ? `${surface!.z.length}×${surface!.z[0]?.length} grid` : 'no surface';
  },

  control: {
    window: { width: 880, height: 620 },

    data(ctx): SurfaceData {
      return (ctx.output.surfaceOut as SurfaceData | undefined)
        ?? { ready: false, z: [], x: [], y: [] };
    },

    render(ctx) {
      const d = ctx.data as SurfaceData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="ps-compact">
  <strong>3D surface</strong>
  <p>${d.ready ? `${d.z.length}×${d.z[0]?.length ?? 0} grid` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="ps"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="ps">
  <header class="head">
    <h1>Rating landscape · weight × year</h1>
    <p class="sub">${d.z.length}×${d.z[0]?.length ?? 0} grid · drag to rotate, scroll to zoom</p>
  </header>
  <div class="plot" data-cocoon-hook="PlotlySurface"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface PlotlyMod {
  newPlot(el: HTMLElement, traces: unknown[], layout: unknown, config?: unknown): Promise<unknown>;
  purge(el: HTMLElement): void;
  Plots: { resize(el: HTMLElement): void };
}

export const hook: ControlHook<SurfaceData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:480px;';
    el.appendChild(root);

    let data = props.data;
    let Plotly: PlotlyMod | undefined;

    const draw = () => {
      if (!Plotly || !data?.ready) return;
      // Plotly mutates trace data internally (range caching, hover lookups).
      // `props.data` is from the reactive controlData store, so writing
      // through it trips Svelte's state_descriptors_fixed. JSON-clone to
      // detach (structuredClone can't handle Svelte's reactive proxies).
      const safe = JSON.parse(JSON.stringify({ z: data.z, x: data.x, y: data.y })) as SurfaceData;
      void Plotly.newPlot(root, [{
        type: 'surface',
        z: safe.z,
        x: safe.x,
        y: safe.y,
        showscale: true,
        colorscale: [
          [0.0, '#3b0a4d'],
          [0.3, '#8b5cf6'],
          [0.6, '#fbbf24'],
          [0.85, '#22d3ee'],
          [1.0, '#f4f4f5'],
        ],
        contours: {
          z: { show: true, usecolormap: true, highlightcolor: '#fff',
               project: { z: true } },
        },
      }], {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e7e7ea', size: 11 },
        margin: { l: 0, r: 0, t: 0, b: 0 },
        scene: {
          xaxis: { title: 'Weight', color: '#9a9aa6', gridcolor: '#27272a' },
          yaxis: { title: 'Year', color: '#9a9aa6', gridcolor: '#27272a' },
          zaxis: { title: 'Rating', color: '#9a9aa6', gridcolor: '#27272a' },
          camera: { eye: { x: 1.4, y: 1.4, z: 0.9 } },
        },
      }, { displaylogo: false, responsive: true });
    };

    const ro = new ResizeObserver(() => Plotly?.Plots.resize(root));
    ro.observe(root);
    import('https://esm.sh/plotly.js-dist-min@2.35.2')
      .then(m => { Plotly = ((m as { default?: PlotlyMod }).default ?? m) as PlotlyMod; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">Plotly failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); try { Plotly?.purge(root); } catch { /* noop */ } root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .ps-compact { display:flex; flex-direction:column; gap:6px; }
.control .ps-compact strong { font-size:12px; color:#fb923c; }
.control .ps-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .ps-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .ps-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .ps { display:flex; flex-direction:column; gap:10px; height:100%; min-height:480px; color:#e7e7ea; font-size:11.5px; }
.control .ps .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .ps .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .ps .plot { flex:1; min-height:480px; }
.control .ps .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
