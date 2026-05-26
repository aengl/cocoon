import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Cytoscape.js standout: force-directed network. The default cose layout
 * is fine for ~150 nodes / ~300 edges. Hover a node to highlight its
 * neighbours; box-select with shift-drag.
 *
 * Cytoscape is the strongest preset-layout catalogue here (cose, breadth-
 * first, circle, concentric, grid). For >500 nodes, swap in `fcose` (an
 * extension) — see the writing-charts.md guide.
 */

interface NetNode { id: string; label: string; group: string; weight: number; }
interface NetEdge { source: string; target: string; weight: number; }
interface NetData { ready: boolean; nodes: NetNode[]; edges: NetEdge[]; groups: string[]; }

export const CytoscapeForce: CocoonProcessNode = {
  category: 'Charts',
  description: 'Cytoscape.js — force-directed designer-collaboration network.',

  async *process(ctx) {
    const { network } = ctx.ports.read() as {
      network?: { nodes: NetNode[]; edges: NetEdge[] };
    };
    const nodes = network?.nodes ?? [];
    const edges = network?.edges ?? [];
    const groups = [...new Set(nodes.map(n => n.group))].sort();
    ctx.ports.write({ net: { ready: nodes.length > 0, nodes, edges, groups } });
    return `${nodes.length} nodes · ${edges.length} edges · ${groups.length} clusters`;
  },

  control: {
    window: { width: 880, height: 620 },

    data(ctx): NetData {
      return (ctx.output.net as NetData | undefined)
        ?? { ready: false, nodes: [], edges: [], groups: [] };
    },

    render(ctx) {
      const d = ctx.data as NetData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="cy-compact">
  <strong>Network</strong>
  <p>${d.ready ? `${d.nodes.length} nodes · ${d.edges.length} edges` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="cy"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="cy">
  <header class="head">
    <h1>Designer collaboration network</h1>
    <p class="sub">${d.nodes.length} nodes · ${d.edges.length} edges · hover to highlight neighbours</p>
  </header>
  <div class="plot" data-cocoon-hook="CytoscapeForce"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface CyInst {
  destroy(): void;
  resize(): void;
  fit(): void;
  on(event: string, selector: string, cb: (e: { target: { id(): string; neighborhood(): { addClass(c: string): void } } }) => void): void;
  elements(sel?: string): { removeClass(c: string): void; addClass(c: string): void };
  layout(opts: unknown): { run(): void };
}
interface CyMod { (opts: unknown): CyInst; }

const PALETTE = ['#8b5cf6', '#fbbf24', '#22d3ee', '#f97373', '#4ade80', '#a78bfa', '#fb923c'];

export const hook: ControlHook<NetData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:440px;';
    el.appendChild(root);

    let data = props.data;
    let cy: CyInst | undefined;
    let cytoscape: CyMod | undefined;

    const draw = () => {
      if (!cytoscape || !data?.ready) return;
      cy?.destroy();
      const groupColor = new Map<string, string>();
      data.groups.forEach((g, i) => groupColor.set(g, PALETTE[i % PALETTE.length] as string));

      const elements = [
        ...data.nodes.map(n => ({
          data: { id: n.id, label: n.label, group: n.group, weight: n.weight },
        })),
        ...data.edges.map(e => ({
          data: { id: `${e.source}--${e.target}`, source: e.source, target: e.target, weight: e.weight },
        })),
      ];

      cy = cytoscape({
        container: root,
        elements,
        boxSelectionEnabled: true,
        autounselectify: false,
        wheelSensitivity: 0.2,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (n: { data: (k: string) => string }) =>
                groupColor.get(n.data('group')) ?? '#8b5cf6',
              label: 'data(label)',
              color: '#e7e7ea',
              'font-size': 9,
              'text-valign': 'center',
              'text-halign': 'center',
              'text-outline-color': '#0d0d0f',
              'text-outline-width': 1.5,
              width: (n: { data: (k: string) => number }) => 8 + n.data('weight') * 0.8,
              height: (n: { data: (k: string) => number }) => 8 + n.data('weight') * 0.8,
              'border-color': '#0d0d0f',
              'border-width': 1,
            },
          },
          {
            selector: 'edge',
            style: {
              width: (e: { data: (k: string) => number }) => Math.min(0.3 + Math.log2(1 + e.data('weight')) * 0.35, 1.6),
              'line-color': '#3f3f46',
              'curve-style': 'bezier',
              opacity: 0.55,
            },
          },
          { selector: 'node.dim', style: { opacity: 0.18 } },
          { selector: 'edge.dim', style: { opacity: 0.06 } },
          { selector: 'node.hi', style: { 'border-color': '#fbbf24', 'border-width': 2, opacity: 1 } },
          { selector: 'edge.hi', style: { 'line-color': '#fbbf24', opacity: 0.9, width: 1.4 } },
        ] as unknown[],
        layout: { name: 'cose', animate: false, idealEdgeLength: 80, nodeRepulsion: 4500, gravity: 0.3 } as unknown,
      });

      cy.on('mouseover', 'node', e => {
        cy?.elements().addClass('dim');
        const nh = e.target.neighborhood();
        nh.addClass('hi');
        (e.target as unknown as { addClass(c: string): void }).addClass('hi');
      });
      cy.on('mouseout', 'node', () => {
        cy?.elements().removeClass('dim');
        cy?.elements().removeClass('hi');
      });
    };

    const ro = new ResizeObserver(() => cy?.resize());
    ro.observe(root);
    import('https://esm.sh/cytoscape@3.30.4')
      .then(m => { cytoscape = ((m as { default?: CyMod }).default ?? m) as CyMod; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">Cytoscape failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); cy?.destroy(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .cy-compact { display:flex; flex-direction:column; gap:6px; }
.control .cy-compact strong { font-size:12px; color:#fb923c; }
.control .cy-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .cy-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .cy-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .cy { display:flex; flex-direction:column; gap:10px; height:100%; min-height:440px; color:#e7e7ea; font-size:11.5px; }
.control .cy .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .cy .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .cy .plot { flex:1; min-height:440px; }
.control .cy .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
