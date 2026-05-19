import type { CocoonProcessNode, ControlHook } from '../contract.ts';

/**
 * Scatterplot — a visualisation node (keystone 2/5). The old framework-
 * agnostic "View" split survives intact, just relocated: the pure
 * `serialiseViewData` half is `control.data` (core-side, bounded), the
 * imperative render half is `export const hook` (browser, zero-dep SVG —
 * legacy used ECharts; this honours "a hook depends on nothing"). There is
 * deliberately **no `event`**: a visualisation is exactly a control with a
 * render hook and no event handler — no separate View subsystem, no
 * `view:` string, no registry.
 *
 * `process` is a pure pass-through (good graph citizen — a downstream node
 * can still consume `data`). Axis/size/colour selection is plain literal
 * `in:` config (the old `viewState`, now versioned YAML — keystone 6: an
 * `in:` key whose value is literal is configuration, kept verbatim).
 *
 * Axis selection is legacy-faithful: with no `x`/`y` configured it defaults
 * to the first/second *numeric* attribute (legacy
 * `listDataAttributes(data, _.isNumber)` — why a `{x,y}` dataset that only
 * sets `color`/`size` still draws an actual shape). If a *resolved* axis has
 * no numeric values, or there aren't two numeric attributes to auto-pick, it
 * falls back to the row index and *labels it as such* so the substitution is
 * honest rather than an empty/throwing chart.
 */

interface ScatterPoint {
  x: number;
  y: number;
  r: number; // size dimension (raw value)
  c: number; // colour dimension (raw value)
  id?: string;
  tip?: string;
}

interface ScatterData {
  ready: boolean;
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  cMin: number;
  cMax: number;
  rMin: number;
  rMax: number;
  total: number;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined;

const fmt = (v: unknown): string =>
  v instanceof Date
    ? v.toISOString().slice(0, 10)
    : v == null
      ? ''
      : String(v);

/**
 * The node ships its own styling inside its rendered HTML (keystone 5/6 —
 * HTML is data, the node's source is the contract). `CocoonNode` provides
 * only generic dark-theme defaults; the plot chrome is the node's, scoped
 * under `.scatter*` so co-resident control surfaces can't collide. The hook
 * container needs a definite size — the detached window gives it height;
 * `min-height` keeps it sane inline.
 */
const STYLE = `<style>
.control .scatter,
.control .scatter-compact { display:flex; flex-direction:column; gap:6px; }
.control .scatter { height:100%; min-height:240px; }
.control .scatter .plot { flex:1; min-height:220px; }
.control .scatter-compact .plot-mini { width:100%; height:150px; }
.control .scatter-foot { font-size:9.5px; color:#71717a; }
</style>`;

export const Scatterplot: CocoonProcessNode = {
  category: 'Visualisation',
  description: 'Scatterplot rendered by a zero-dep SVG control hook.',

  async *process(ctx) {
    const { data } = ctx.ports.read() as { data?: unknown[] };
    const rows = Array.isArray(data) ? data : [];
    ctx.ports.write({ data: rows });
    return `${rows.length} rows`;
  },

  control: {
    // Data half — the `serialiseViewData` twin. Reads the *frozen pull
    // output* (keystone-5 frozen-batch read) for rows and the literal `in:`
    // config for the dimensions. Pure, bounded, no cache.
    data(ctx): ScatterData {
      const cfg = ctx.ports.read() as {
        x?: string;
        y?: string;
        size?: string;
        color?: string;
        id?: string;
        tooltip?: string[];
      };
      const out = ctx.output.data;
      const rows = (Array.isArray(out) ? out : []) as Record<
        string,
        unknown
      >[];
      const empty: ScatterData = {
        ready: false,
        points: [],
        xLabel: '',
        yLabel: '',
        cMin: 0,
        cMax: 1,
        rMin: 0,
        rMax: 1,
        total: 0,
      };
      if (!rows.length) return empty;

      // Legacy `listDataAttributes(data, _.isNumber)`: keys holding a numeric
      // value in at least one row, first-seen order. The axes default to the
      // first/second of these when x/y aren't configured.
      const available: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        if (!r) continue;
        for (const k of Object.keys(r)) {
          if (!seen.has(k) && num(r[k]) !== undefined) {
            seen.add(k);
            available.push(k);
          }
        }
      }
      const xKey = cfg.x ?? available[0];
      const yKey = cfg.y ?? available[1];

      // The resolved dimension if it has numeric values; otherwise the row
      // index, *labelled* so the substitution is honest.
      const axis = (key?: string) => {
        if (key) {
          const vals = rows.map(r => num(r?.[key]));
          if (vals.some(v => v !== undefined)) return { vals, label: key };
          return { vals: rows.map((_, i) => i), label: `${key} (index)` };
        }
        return { vals: rows.map((_, i) => i), label: 'index' };
      };
      const X = axis(xKey);
      const Y = axis(yKey);

      const cVals = cfg.color
        ? rows.map(r => num(r?.[cfg.color!]))
        : undefined;
      const sVals = cfg.size
        ? rows.map(r => num(r?.[cfg.size!]))
        : undefined;
      const range = (vals?: (number | undefined)[]): [number, number] => {
        const f = (vals ?? []).filter(
          (v): v is number => v !== undefined
        );
        return f.length ? [Math.min(...f), Math.max(...f)] : [0, 1];
      };
      const [cMin, cMax] = range(cVals);
      const [rMin, rMax] = range(sVals);
      const tipKeys = cfg.tooltip ?? [];

      const points: ScatterPoint[] = [];
      for (let i = 0; i < rows.length; i++) {
        const x = X.vals[i];
        const y = Y.vals[i];
        if (x === undefined || y === undefined) continue;
        points.push({
          x,
          y,
          c: cVals?.[i] ?? cMin,
          r: sVals?.[i] ?? rMin,
          id: cfg.id ? fmt(rows[i]?.[cfg.id]) : undefined,
          tip: tipKeys.length
            ? tipKeys.map(k => `${k}: ${fmt(rows[i]?.[k])}`).join('  ·  ')
            : undefined,
        });
      }
      if (!points.length) return empty;
      return {
        ready: true,
        points,
        xLabel: X.label,
        yLabel: Y.label,
        cMin,
        cMax,
        rMin,
        rMax,
        total: rows.length,
      };
    },

    render(ctx) {
      const d = ctx.data as ScatterData | undefined;
      const compact = ctx.surface === 'node';

      if (!d?.ready) {
        const msg = 'run the node to plot the data';
        return compact
          ? `${STYLE}<div class="scatter-compact"><strong>Scatterplot</strong><p>${msg}</p>
  <button data-cocoon-event="$open">Open plot ▸</button></div>`
          : `${STYLE}<div class="scatter"><p>${msg}</p></div>`;
      }

      // Compact node surface: the SAME hook, a smaller box. The hook scales
      // to its container, so inline and windowed are one renderer at two
      // sizes — the open button still pops the roomier window.
      if (compact)
        return `${STYLE}<div class="scatter-compact">
  <div class="plot-mini" data-cocoon-hook="Scatterplot"></div>
  <p>${d.total} points · ${d.xLabel} × ${d.yLabel}</p>
  <button data-cocoon-event="$open">Open plot ▸</button>
</div>`;

      return `${STYLE}<div class="scatter">
  <div class="plot" data-cocoon-hook="Scatterplot"></div>
  <p class="scatter-foot">${d.total} points · ${d.xLabel} × ${d.yLabel} — zero-dep SVG drawn by the control render hook (keystone 2/5)</p>
</div>`;
    },
  },
};

/**
 * The browser render hook — the **same source module as the node**
 * (keystone 2/5, true single-file co-location). Zero dependencies (no CDN
 * import needed): plain SVG + pointer interaction. The core never evaluates
 * this; the delivery seam esbuild-bundles only this export. `props.data` is
 * the streamed `controlData` (`control.data` above). Self-sizes via its own
 * `ResizeObserver` (the generic `controlAction` shim does no resize
 * feedback).
 */
export const hook: ControlHook<ScatterData> = {
  mount(el, props) {
    const NS = 'http://www.w3.org/2000/svg';

    // `height:100%` fills a host that resolves a height; `min-height` is the
    // defensive floor so a render hook is NEVER a zero-height (invisible)
    // box. The SVG is absolutely-positioned so it never feeds its own size
    // back into layout (no resize loop).
    const root = document.createElement('div');
    root.style.cssText =
      'position:relative;width:100%;height:100%;min-height:150px;overflow:hidden';
    el.appendChild(root);

    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block';
    root.appendChild(svg);

    const tip = document.createElement('div');
    tip.style.cssText =
      'position:absolute;pointer-events:none;display:none;background:#0c0a09;' +
      'color:#e7e5e4;border:1px solid #3f3f46;border-radius:5px;padding:4px 7px;' +
      'font-size:10px;max-width:200px;z-index:5;white-space:nowrap';
    root.appendChild(tip);

    let data = props.data;
    let placed: { px: number; py: number; p: ScatterPoint }[] = [];
    let frame = { w: 320, h: 220 };

    const colour = (c: number) => {
      const { cMin, cMax } = data;
      const t = cMax > cMin ? (c - cMin) / (cMax - cMin) : 0.5;
      return `hsl(${Math.round(205 - t * 195)} 85% 62%)`;
    };
    const radius = (r: number) => {
      const { rMin, rMax } = data;
      const t = rMax > rMin ? (r - rMin) / (rMax - rMin) : 0;
      return 2 + t * 5;
    };

    const draw = () => {
      if (!data?.ready) return;
      const { points, xLabel, yLabel } = data;
      const w = root.clientWidth || 320;
      const h = root.clientHeight || 220;
      const m = { l: 40, r: 10, t: 10, b: 26 };
      frame = { w, h };
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const xMin = Math.min(...xs),
        xMax = Math.max(...xs);
      const yMin = Math.min(...ys),
        yMax = Math.max(...ys);
      const sx = (v: number) =>
        m.l +
        (xMax > xMin ? (v - xMin) / (xMax - xMin) : 0.5) * (w - m.l - m.r);
      const sy = (v: number) =>
        h -
        m.b -
        (yMax > yMin ? (v - yMin) / (yMax - yMin) : 0.5) *
          (h - m.t - m.b);

      const line = (x1: number, y1: number, x2: number, y2: number) => {
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', `${x1}`);
        l.setAttribute('y1', `${y1}`);
        l.setAttribute('x2', `${x2}`);
        l.setAttribute('y2', `${y2}`);
        l.setAttribute('stroke', '#3f3f46');
        svg.appendChild(l);
      };
      const text = (s: string, x: number, y: number, anchor = 'middle') => {
        const t = document.createElementNS(NS, 'text');
        t.textContent = s;
        t.setAttribute('x', `${x}`);
        t.setAttribute('y', `${y}`);
        t.setAttribute('fill', '#a1a1aa');
        t.setAttribute('font-size', '9');
        t.setAttribute('text-anchor', anchor);
        svg.appendChild(t);
      };

      line(m.l, m.t, m.l, h - m.b);
      line(m.l, h - m.b, w - m.r, h - m.b);
      const tidy = (v: number) =>
        Math.abs(v) >= 100 || Number.isInteger(v)
          ? v.toFixed(0)
          : v.toFixed(2);
      text(tidy(yMax), m.l - 4, m.t + 8, 'end');
      text(tidy(yMin), m.l - 4, h - m.b, 'end');
      text(tidy(xMin), m.l, h - m.b + 12, 'start');
      text(tidy(xMax), w - m.r, h - m.b + 12, 'end');
      text(xLabel, (m.l + w - m.r) / 2, h - 3);
      const yl = document.createElementNS(NS, 'text');
      yl.textContent = yLabel;
      yl.setAttribute(
        'transform',
        `translate(9 ${(m.t + h - m.b) / 2}) rotate(-90)`
      );
      yl.setAttribute('fill', '#a1a1aa');
      yl.setAttribute('font-size', '9');
      yl.setAttribute('text-anchor', 'middle');
      svg.appendChild(yl);

      placed = [];
      for (const p of points) {
        const px = sx(p.x);
        const py = sy(p.y);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', `${px}`);
        c.setAttribute('cy', `${py}`);
        c.setAttribute('r', `${radius(p.r)}`);
        c.setAttribute('fill', colour(p.c));
        c.setAttribute('fill-opacity', '0.72');
        svg.appendChild(c);
        placed.push({ px, py, p });
      }
    };

    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / (r.width || 1)) * frame.w;
      const my = ((e.clientY - r.top) / (r.height || 1)) * frame.h;
      let best: (typeof placed)[number] | undefined;
      let bd = 100;
      for (const q of placed) {
        const dd = (q.px - mx) ** 2 + (q.py - my) ** 2;
        if (dd < bd) {
          bd = dd;
          best = q;
        }
      }
      if (!best || !data) {
        tip.style.display = 'none';
        return;
      }
      tip.innerHTML =
        (best.p.id ? `<strong>${best.p.id}</strong><br/>` : '') +
        (best.p.tip ? `${best.p.tip}<br/>` : '') +
        `<span style="color:#a1a1aa">${data.xLabel} ${best.p.x}` +
        `  ·  ${data.yLabel} ${best.p.y}</span>`;
      tip.style.display = 'block';
      tip.style.left = `${Math.min(mx + 10, (root.clientWidth || 320) - 190)}px`;
      tip.style.top = `${my + 10}px`;
    };

    svg.addEventListener('pointermove', onMove);
    svg.addEventListener(
      'pointerleave',
      () => (tip.style.display = 'none')
    );

    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    });
    ro.observe(root);
    draw();

    return {
      update(next) {
        data = next.data;
        draw();
      },
      destroy() {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        svg.removeEventListener('pointermove', onMove);
        root.remove();
      },
    };
  },
};
