import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Vega-Lite standout: linked-brush crossfilter. Three views — scatter,
 * histogram by category, histogram by year — share one interval brush
 * (drag on the scatter to filter the histograms). Selections + params
 * are first-class JSON in Vega-Lite, which is the whole reason to pick
 * it over ECharts/Plot for interaction-heavy specs.
 */

interface Point { id: string; x: number; y: number; category: string; year: number; }
interface BrushData { ready: boolean; points: Point[]; n: number; }

const MAX_POINTS = 1200;

export const VegaLiteBrush: CocoonProcessNode = {
  category: 'Charts',
  description: 'Vega-Lite — linked-brush crossfilter (scatter + 2 histograms).',

  async *process(ctx) {
    const { points } = ctx.ports.read() as { points?: Point[] };
    const rows = (Array.isArray(points) ? points : []).slice(0, MAX_POINTS);
    ctx.ports.write({ brush: { ready: rows.length > 0, points: rows, n: rows.length } });
    return `${rows.length} points`;
  },

  control: {
    window: { width: 940, height: 640 },

    data(ctx): BrushData {
      return (ctx.output.brush as BrushData | undefined)
        ?? { ready: false, points: [], n: 0 };
    },

    render(ctx) {
      const d = ctx.data as BrushData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="vl-compact">
  <strong>Linked brush</strong>
  <p>${d.ready ? `${d.n} points · drag to crossfilter` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="vl"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="vl">
  <header class="head">
    <h1>Brush on the scatter — the histograms follow</h1>
    <p class="sub">${d.n} points · interval selection across three views</p>
  </header>
  <div class="plot" data-cocoon-hook="VegaLiteBrush"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface EmbedResult { view: { finalize(): void } }
type EmbedFn = (el: HTMLElement, spec: unknown, opts?: unknown) => Promise<EmbedResult>;

export const hook: ControlHook<BrushData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:420px;';
    el.appendChild(root);

    let data = props.data;
    let embed: EmbedFn | undefined;
    let result: EmbedResult | undefined;
    let drawing = false;

    const buildSpec = (rows: Point[]) => ({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      background: 'transparent',
      config: {
        view: { stroke: '#3c3c47' },
        axis: {
          domainColor: '#3c3c47', tickColor: '#3c3c47',
          gridColor: '#27272a', labelColor: '#9a9aa6', titleColor: '#c4b5fd',
          labelFontSize: 10, titleFontSize: 11,
        },
        legend: { labelColor: '#e7e7ea', titleColor: '#c4b5fd' },
        title: { color: '#fb923c' },
      },
      data: { values: rows },
      vconcat: [
        {
          width: 'container',
          height: 280,
          mark: { type: 'point', filled: true, size: 32, opacity: 0.7 },
          params: [{ name: 'brush', select: { type: 'interval' } }],
          encoding: {
            x: { field: 'x', type: 'quantitative', title: 'Weight', scale: { domain: [1, 5] } },
            y: { field: 'y', type: 'quantitative', title: 'Rating', scale: { domain: [3, 10] } },
            color: {
              condition: { param: 'brush', field: 'category', type: 'nominal',
                scale: { range: ['#8b5cf6', '#fbbf24', '#22d3ee', '#f97373', '#4ade80'] } },
              value: '#3f3f46',
            },
            tooltip: [
              { field: 'category', type: 'nominal' },
              { field: 'year', type: 'quantitative' },
              { field: 'x', type: 'quantitative', title: 'weight' },
              { field: 'y', type: 'quantitative', title: 'rating' },
            ],
          },
        },
        {
          hconcat: [
            {
              width: 'container',
              height: 160,
              transform: [{ filter: { param: 'brush' } }],
              mark: { type: 'bar', color: '#8b5cf6' },
              encoding: {
                x: { field: 'category', type: 'nominal', title: 'Category' },
                y: { aggregate: 'count', title: 'Selected' },
              },
            },
            {
              width: 'container',
              height: 160,
              transform: [{ filter: { param: 'brush' } }],
              mark: { type: 'bar', color: '#fbbf24' },
              encoding: {
                x: { field: 'year', type: 'ordinal', title: 'Year', axis: { labelAngle: -45, labelOverlap: 'parity' } },
                y: { aggregate: 'count', title: 'Selected' },
              },
            },
          ],
        },
      ],
    });

    const draw = async () => {
      if (!embed || !data?.ready || drawing) return;
      drawing = true;
      try {
        result?.view.finalize();
        result = await embed(root, buildSpec(data.points), {
          actions: false,
          renderer: 'canvas',
          theme: 'dark',
        });
      } catch (err) {
        root.innerHTML = `<pre style="color:#f97373;padding:12px;">Vega-Lite failed: ${String(err)}</pre>`;
      } finally {
        drawing = false;
      }
    };

    import('https://esm.sh/vega-embed@6.26.0')
      .then(m => { embed = (m as { default: EmbedFn }).default ?? (m as unknown as EmbedFn); void draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">vega-embed failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; void draw(); },
      destroy()    { result?.view.finalize(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .vl-compact { display:flex; flex-direction:column; gap:6px; }
.control .vl-compact strong { font-size:12px; color:#fb923c; }
.control .vl-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .vl-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .vl-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .vl { display:flex; flex-direction:column; gap:10px; height:100%; min-height:420px; color:#e7e7ea; font-size:11.5px; }
.control .vl .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .vl .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .vl .plot { flex:1; min-height:420px; }
.control .vl .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
