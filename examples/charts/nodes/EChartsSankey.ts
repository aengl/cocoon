import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * ECharts standout: a sankey (three-column flow graph). Showcases what
 * ECharts owns categorically — multi-level flow layouts with curved bezier
 * links, hover-glow, and a built-in dark theme that already matches the
 * Cocoon palette.
 *
 * Why this chart? Sankeys are notoriously fiddly to hand-roll (D3-sankey
 * is fine but verbose), and the result here is one ECharts option object.
 */

interface Link { source: string; target: string; value: number; }
interface SankeyData {
  ready: boolean;
  nodes: { name: string }[];
  links: Link[];
  totalFlow: number;
}

export const EChartsSankey: CocoonProcessNode = {
  category: 'Charts',
  description: 'ECharts sankey — designer → category → rating bucket.',

  async *process(ctx) {
    const { flows } = ctx.ports.read() as {
      flows?: { nodes: { name: string }[]; links: Link[] };
    };
    const nodes = flows?.nodes ?? [];
    const links = flows?.links ?? [];
    const totalFlow = links.reduce((a, l) => a + l.value, 0);
    ctx.ports.write({
      sankey: { ready: nodes.length > 0, nodes, links, totalFlow },
    });
    return `${nodes.length} nodes · ${links.length} links · ${totalFlow} flow`;
  },

  control: {
    window: { width: 880, height: 560 },

    data(ctx): SankeyData {
      return (ctx.output.sankey as SankeyData | undefined)
        ?? { ready: false, nodes: [], links: [], totalFlow: 0 };
    },

    render(ctx) {
      const d = ctx.data as SankeyData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="sk-compact">
  <strong>Sankey</strong>
  <p>${d.ready ? `${d.nodes.length} nodes · ${d.links.length} links` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="sk"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="sk">
  <header class="head">
    <h1>Designer → Category → Rating</h1>
    <p class="sub">${d.nodes.length} nodes · ${d.links.length} links · total flow ${d.totalFlow}</p>
  </header>
  <div class="plot" data-cocoon-hook="EChartsSankey"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface EChartsInst { setOption(o: unknown): void; resize(): void; dispose(): void; }
interface EChartsMod { init(el: HTMLElement, theme?: string): EChartsInst; }

export const hook: ControlHook<SankeyData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:380px;';
    el.appendChild(root);

    let data = props.data;
    let chart: EChartsInst | undefined;
    let echarts: EChartsMod | undefined;

    const draw = () => {
      if (!echarts || !data?.ready) return;
      if (!chart) chart = echarts.init(root, 'dark');
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: '#1a1a20',
          borderColor: '#3c3c47',
          textStyle: { color: '#e7e7ea', fontSize: 11 },
        },
        series: [{
          type: 'sankey',
          data: data.nodes,
          links: data.links,
          orient: 'horizontal',
          nodeAlign: 'justify',
          nodeWidth: 14,
          nodeGap: 8,
          left: 12, right: 80, top: 16, bottom: 16,
          label: { color: '#e7e7ea', fontSize: 11 },
          lineStyle: { color: 'gradient', opacity: 0.45, curveness: 0.5 },
          emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.85 } },
          levels: [
            { depth: 0, itemStyle: { color: '#8b5cf6' } },
            { depth: 1, itemStyle: { color: '#fbbf24' } },
            { depth: 2, itemStyle: { color: '#22d3ee' } },
          ],
        }],
      });
      chart.resize();
    };

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(root);
    import('https://esm.sh/echarts@5.4.3')
      .then(m => { echarts = m as unknown as EChartsMod; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">ECharts failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); chart?.dispose(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .sk-compact { display:flex; flex-direction:column; gap:6px; }
.control .sk-compact strong { font-size:12px; color:#fb923c; }
.control .sk-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .sk-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .sk-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .sk { display:flex; flex-direction:column; gap:10px; height:100%; min-height:380px; color:#e7e7ea; font-size:11.5px; }
.control .sk .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .sk .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .sk .plot { flex:1; min-height:380px; }
.control .sk .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
