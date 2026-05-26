import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * D3 standout: beeswarm — one of the few common charts no high-level
 * library does well. Each dot is a game; x positions by category, y by
 * rating; d3-force does the non-overlapping packing.
 *
 * The whole layout is the value-add of using D3: 30 lines of force
 * simulation + scales beats any preset.
 */

interface Row { group: string; value: number; id: string; name: string; }
interface BeeData { ready: boolean; rows: Row[]; groups: string[]; n: number; }

const MAX_ROWS = 1500;

export const D3Beeswarm: CocoonProcessNode = {
  category: 'Charts',
  description: 'D3 — beeswarm of rating by category (force-packed).',

  async *process(ctx) {
    const { distribution } = ctx.ports.read() as { distribution?: Row[] };
    const rows = (Array.isArray(distribution) ? distribution : []).slice(0, MAX_ROWS);
    const groups = [...new Set(rows.map(r => r.group))].sort();
    ctx.ports.write({ beeswarm: { ready: rows.length > 0, rows, groups, n: rows.length } });
    return `${rows.length} dots · ${groups.length} groups`;
  },

  control: {
    window: { width: 820, height: 560 },

    data(ctx): BeeData {
      return (ctx.output.beeswarm as BeeData | undefined)
        ?? { ready: false, rows: [], groups: [], n: 0 };
    },

    render(ctx) {
      const d = ctx.data as BeeData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="bs-compact">
  <strong>Beeswarm</strong>
  <p>${d.ready ? `${d.n} dots · ${d.groups.length} groups` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="bs"><p class="empty">pull Seed upstream first</p></div>`;
      return `${STYLE}<div class="bs">
  <header class="head">
    <h1>Rating distribution per category</h1>
    <p class="sub">${d.n} games · d3-force packing</p>
  </header>
  <div class="plot" data-cocoon-hook="D3Beeswarm"></div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------

interface D3Sim {
  nodes(n: unknown[]): D3Sim;
  force(name: string, f: unknown): D3Sim;
  on(ev: string, cb: () => void): D3Sim;
  stop(): D3Sim;
  alpha(a: number): D3Sim;
  restart(): D3Sim;
  tick(n?: number): D3Sim;
}
interface D3Mod {
  scaleLinear(): { domain(d: number[]): { range(r: number[]): (v: number) => number } };
  scaleBand(): { domain(d: string[]): { range(r: number[]): { padding(p: number): { (v: string): number; bandwidth(): number } } } };
  scaleOrdinal(): { domain(d: string[]): { range(r: string[]): (v: string) => string } };
  forceSimulation(): D3Sim;
  forceX(x: (d: unknown) => number): { strength(s: number): unknown };
  forceY(y: (d: unknown) => number): { strength(s: number): unknown };
  forceCollide(r: number): unknown;
}

interface Node extends Row { x: number; y: number; cx: number; cy: number; }

export const hook: ControlHook<BeeData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:380px;position:relative;';
    el.appendChild(root);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'width:100%;height:100%;display:block;';
    root.appendChild(svg);

    let data = props.data;
    let d3: D3Mod | undefined;

    const draw = () => {
      if (!d3 || !data?.ready) return;
      const w = root.clientWidth || 800;
      const h = root.clientHeight || 500;
      const margin = { top: 20, right: 16, bottom: 36, left: 44 };

      const x = d3.scaleBand().domain(data.groups).range([margin.left, w - margin.right]).padding(0.15);
      const y = d3.scaleLinear().domain([10, 1]).range([margin.top, h - margin.bottom]); // inverted: high rating top
      const color = d3.scaleOrdinal()
        .domain(data.groups)
        .range(['#8b5cf6', '#fbbf24', '#22d3ee', '#f97373', '#4ade80']);

      const nodes: Node[] = data.rows.map(r => ({
        ...r,
        cx: x(r.group) + x.bandwidth() / 2,
        cy: y(r.value),
        x: x(r.group) + x.bandwidth() / 2,
        y: y(r.value),
      }));

      const sim = d3.forceSimulation()
        .nodes(nodes as unknown[])
        .force('x', d3.forceX((d: unknown) => (d as Node).cx).strength(0.95))
        .force('y', d3.forceY((d: unknown) => (d as Node).cy).strength(0.55))
        .force('collide', d3.forceCollide(3.2))
        .stop();
      for (let i = 0; i < 140; i++) sim.tick();

      // Clear svg
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // Axes (manual, kept tiny)
      const axisG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(axisG);

      // X labels
      for (const g of data.groups) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', String(x(g) + x.bandwidth() / 2));
        t.setAttribute('y', String(h - margin.bottom + 18));
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', '#9a9aa6');
        t.setAttribute('font-size', '11');
        t.textContent = g;
        axisG.appendChild(t);
      }
      // Y axis ticks
      for (const v of [2, 4, 6, 8, 10]) {
        const yp = y(v);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(margin.left));
        line.setAttribute('x2', String(w - margin.right));
        line.setAttribute('y1', String(yp));
        line.setAttribute('y2', String(yp));
        line.setAttribute('stroke', '#27272a');
        line.setAttribute('stroke-width', '1');
        axisG.appendChild(line);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', String(margin.left - 8));
        t.setAttribute('y', String(yp + 3));
        t.setAttribute('text-anchor', 'end');
        t.setAttribute('fill', '#9a9aa6');
        t.setAttribute('font-size', '10');
        t.textContent = String(v);
        axisG.appendChild(t);
      }

      // Dots
      const dotsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(dotsG);
      for (const n of nodes) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', String(n.x));
        c.setAttribute('cy', String(n.y));
        c.setAttribute('r', '2.6');
        c.setAttribute('fill', color(n.group));
        c.setAttribute('fill-opacity', '0.78');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${n.name} — ${n.value.toFixed(2)}`;
        c.appendChild(title);
        dotsG.appendChild(c);
      }
    };

    const ro = new ResizeObserver(() => draw());
    ro.observe(root);
    import('https://esm.sh/d3@7.9.0')
      .then(m => { d3 = m as unknown as D3Mod; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">D3 failed: ${String(err)}</pre>`; });

    return {
      update(next) { data = next.data ?? data; draw(); },
      destroy()    { ro.disconnect(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .bs-compact { display:flex; flex-direction:column; gap:6px; }
.control .bs-compact strong { font-size:12px; color:#fb923c; }
.control .bs-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .bs-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .bs-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .bs { display:flex; flex-direction:column; gap:10px; height:100%; min-height:380px; color:#e7e7ea; font-size:11.5px; }
.control .bs .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .bs .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .bs .plot { flex:1; min-height:380px; }
.control .bs .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
