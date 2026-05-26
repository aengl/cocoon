import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Observable Plot standout: small-multiples grid via `fx` faceting. One
 * panel per category, each panel a rating-vs-weight scatter with a linear
 * regression overlay. Plot's grammar collapses what would be ~150 lines of
 * D3 into a few marks; faceting is one extra channel.
 */

interface Row { facet: string; x: number; y: number; year: number; }
interface FacetedData { ready: boolean; rows: Row[]; facets: string[]; n: number; }

const MAX_ROWS = 1200;

export const PlotFaceted: CocoonProcessNode = {
  category: 'Charts',
  description: 'Observable Plot — faceted rating × weight, one panel per category.',

  async *process(ctx) {
    const { tidy } = ctx.ports.read() as { tidy?: Row[] };
    const rows = (Array.isArray(tidy) ? tidy : []).slice(0, MAX_ROWS);
    const facets = [...new Set(rows.map(r => r.facet))].sort();
    ctx.ports.write({ faceted: { ready: rows.length > 0, rows, facets, n: rows.length } });
    return `${rows.length} rows · ${facets.length} facets`;
  },

  control: {
    window: { width: 900, height: 600 },

    data(ctx): FacetedData {
      return (ctx.output.faceted as FacetedData | undefined)
        ?? { ready: false, rows: [], facets: [], n: 0 };
    },

    render(ctx) {
      const d = ctx.data as FacetedData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="pf-compact">
  <strong>Faceted</strong>
  <p>${d.ready ? `${d.n} rows · ${d.facets.length} panels` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="pf"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="pf">
  <header class="head">
    <h1>Rating × Weight, faceted by category</h1>
    <p class="sub">${d.n} rows · ${d.facets.length} facets · linear fit per panel</p>
  </header>
  <div class="plot" data-cocoon-hook="PlotFaceted"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface PlotMod {
  plot(opts: unknown): SVGElement;
  dot(data: Row[], opts: unknown): unknown;
  linearRegressionY(data: Row[], opts: unknown): unknown;
  ruleY(values: number[], opts?: unknown): unknown;
  frame(opts?: unknown): unknown;
}

export const hook: ControlHook<FacetedData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:380px;display:flex;';
    el.appendChild(root);

    let data = props.data;
    let Plot: PlotMod | undefined;

    const draw = () => {
      if (!Plot || !data?.ready) return;
      const w = root.clientWidth || 800;
      const h = root.clientHeight || 500;
      const node = Plot.plot({
        width: w,
        height: h,
        style: { background: 'transparent', color: '#e7e7ea', fontSize: '11px' },
        marginBottom: 38,
        marginLeft: 44,
        x: { label: 'Weight →', grid: true, domain: [1, 5] },
        y: { label: '↑ Rating', grid: true, domain: [4, 10] },
        color: { type: 'categorical', scheme: 'observable10' },
        fx: { label: null, padding: 0.08 },
        marks: [
          Plot.frame({ stroke: '#27272a' }),
          Plot.dot(data.rows, {
            x: 'x', y: 'y', fx: 'facet',
            fill: 'facet', stroke: 'facet',
            r: 2.4, fillOpacity: 0.55,
          }),
          Plot.linearRegressionY(data.rows, {
            x: 'x', y: 'y', fx: 'facet',
            stroke: '#fbbf24', strokeWidth: 1.4,
          }),
        ],
      });
      root.replaceChildren(node);
    };

    const ro = new ResizeObserver(() => draw());
    ro.observe(root);
    import('https://esm.sh/@observablehq/plot@0.6.16')
      .then(m => { Plot = m as unknown as PlotMod; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">Plot failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .pf-compact { display:flex; flex-direction:column; gap:6px; }
.control .pf-compact strong { font-size:12px; color:#fb923c; }
.control .pf-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .pf-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .pf-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .pf { display:flex; flex-direction:column; gap:10px; height:100%; min-height:380px; color:#e7e7ea; font-size:11.5px; }
.control .pf .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .pf .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .pf .plot { flex:1; min-height:380px; }
.control .pf .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
