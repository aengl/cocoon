import type { CocoonView } from '../view-contract';

/**
 * The legacy `Scatterplot` view (legacy used ECharts; this is zero-dependency
 * SVG to honour the "a View depends on nothing" thesis — same as
 * `sparkline.ts`). `serialiseViewData` runs in the core and reduces the full
 * dataset to a compact point array; only that crosses the wire.
 *
 * Axis selection is legacy-faithful: when `viewState` doesn't set `x`/`y`,
 * legacy `serialiseViewData` defaults them to the first/second *numeric*
 * data attribute (`listDataAttributes(data, _.isNumber)`). This is why the
 * Circle example — whose `viewState` sets only `color`/`size` — draws an
 * actual circle (`x` vs `y`) rather than index-vs-index.
 *
 * Better-than-legacy touch: if a *resolved* axis dimension has no numeric
 * values (the simple-api example asks for `x: tz`, which USGS returns as all
 * null) or there aren't two numeric attributes to auto-pick, legacy ECharts
 * would draw an empty chart (or throw "no suitable axis dimensions found").
 * Here we fall back to the row index for that axis and *label it as such*,
 * so the plot is still meaningful and the substitution is honest.
 *
 * The plot self-sizes to its host: `mount` fills a height-definite container
 * (the detached ViewWindow — so it uses all that real-estate and grows when
 * the window is dragged bigger, redrawn by viewAction's ResizeObserver) and
 * falls back to a `min-height` floor in the cramped inline node preview.
 */

export interface ScatterPoint {
  x: number;
  y: number;
  r: number; // size dimension (raw value)
  c: number; // colour dimension (raw value)
  id?: string;
  tip?: string;
}

export interface ScatterData {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  cMin: number;
  cMax: number;
  rMin: number;
  rMax: number;
  total: number;
}

export interface ScatterState {
  x?: string;
  y?: string;
  size?: string;
  color?: string;
  id?: string;
  tooltip?: string[];
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined;

const fmt = (v: unknown): string =>
  v instanceof Date
    ? v.toISOString().slice(0, 10)
    : v == null
      ? ''
      : String(v);

export const Scatterplot: CocoonView<ScatterData, ScatterState> = {
  serialiseViewData(data, state) {
    if (!data.length) return null;
    const rows = data as Record<string, unknown>[];

    // Legacy `listDataAttributes(data, _.isNumber)`: data keys holding a
    // numeric value in at least one row, first-seen order. Legacy defaults
    // the axes to the first/second of these when x/y aren't configured.
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
    const xKey = state.x ?? available[0];
    const yKey = state.y ?? available[1];

    // The resolved dimension if it has numeric values; otherwise the row
    // index, *labelled* so the substitution is honest (configured-but-null
    // like `x: tz`, or fewer than two numeric attributes to auto-pick).
    const axis = (key?: string) => {
      if (key) {
        const vals = rows.map(r => num(r?.[key]));
        if (vals.some(v => v !== undefined))
          return { vals, label: key };
        return { vals: rows.map((_, i) => i), label: `${key} (index)` };
      }
      return { vals: rows.map((_, i) => i), label: 'index' };
    };
    const X = axis(xKey);
    const Y = axis(yKey);

    const cVals = state.color
      ? rows.map(r => num(r?.[state.color!]))
      : undefined;
    const sVals = state.size
      ? rows.map(r => num(r?.[state.size!]))
      : undefined;
    const range = (vals?: (number | undefined)[]): [number, number] => {
      const f = (vals ?? []).filter(
        (v): v is number => v !== undefined
      );
      return f.length ? [Math.min(...f), Math.max(...f)] : [0, 1];
    };
    const [cMin, cMax] = range(cVals);
    const [rMin, rMax] = range(sVals);
    const tipKeys = state.tooltip ?? [];

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
        id: state.id ? fmt(rows[i]?.[state.id]) : undefined,
        tip: tipKeys.length
          ? tipKeys.map(k => `${k}: ${fmt(rows[i]?.[k])}`).join('  ·  ')
          : undefined,
      });
    }
    if (!points.length) return null;
    return {
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

  mount(el, props) {
    const NS = 'http://www.w3.org/2000/svg';

    // A self-sized root: `height:100%` fills a host that gives it a definite
    // height (the detached ViewWindow), while `min-height` keeps the cramped
    // inline node preview sensible. The SVG is absolutely-positioned so it
    // never feeds its own size back into layout (no resize loop); the viewBox
    // is the root's pixel box, so screen px ≈ viewBox units 1:1.
    const root = document.createElement('div');
    root.style.cssText =
      'position:relative;width:100%;height:100%;min-height:220px;overflow:hidden';
    el.appendChild(root);

    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block';
    root.appendChild(svg);

    const tip = document.createElement('div');
    tip.className = 'scatter-tip';
    tip.style.cssText =
      'position:absolute;pointer-events:none;display:none;background:#0c0a09;' +
      'color:#e7e5e4;border:1px solid #3f3f46;border-radius:5px;padding:4px 7px;' +
      'font-size:10px;max-width:200px;z-index:5;white-space:nowrap';
    root.appendChild(tip);

    let current = props;
    // Pixel positions kept for nearest-point hit testing.
    let placed: { px: number; py: number; p: ScatterPoint }[] = [];
    // Last drawn viewBox size — lets a tooltip map client px → viewBox units.
    let frame = { w: 320, h: 220 };

    const colour = (c: number) => {
      const { cMin, cMax } = current.data;
      const t = cMax > cMin ? (c - cMin) / (cMax - cMin) : 0.5;
      return `hsl(${Math.round(205 - t * 195)} 85% 62%)`;
    };
    const radius = (r: number) => {
      const { rMin, rMax } = current.data;
      const t = rMax > rMin ? (r - rMin) / (rMax - rMin) : 0;
      return 2 + t * 5;
    };

    const draw = () => {
      const { points, xLabel, yLabel } = current.data;
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
        (xMax > xMin ? (v - xMin) / (xMax - xMin) : 0.5) *
          (w - m.l - m.r);
      const sy = (v: number) =>
        h -
        m.b -
        (yMax > yMin ? (v - yMin) / (yMax - yMin) : 0.5) *
          (h - m.t - m.b);

      const line = (
        x1: number,
        y1: number,
        x2: number,
        y2: number
      ) => {
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', `${x1}`);
        l.setAttribute('y1', `${y1}`);
        l.setAttribute('x2', `${x2}`);
        l.setAttribute('y2', `${y2}`);
        l.setAttribute('stroke', '#3f3f46');
        svg.appendChild(l);
      };
      const text = (
        s: string,
        x: number,
        y: number,
        anchor = 'middle'
      ) => {
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
      // Client px → viewBox units (robust if the SVG was resized since the
      // last draw: scale by the live rendered box, not an assumed 1:1).
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / (r.width || 1)) * frame.w;
      const my = ((e.clientY - r.top) / (r.height || 1)) * frame.h;
      let best: (typeof placed)[number] | undefined;
      let bd = 100;
      for (const q of placed) {
        const d = (q.px - mx) ** 2 + (q.py - my) ** 2;
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (!best) {
        tip.style.display = 'none';
        return;
      }
      tip.innerHTML =
        (best.p.id ? `<strong>${best.p.id}</strong><br/>` : '') +
        (best.p.tip ? `${best.p.tip}<br/>` : '') +
        `<span style="color:#a1a1aa">${current.data.xLabel} ${best.p.x}` +
        `  ·  ${current.data.yLabel} ${best.p.y}</span>`;
      tip.style.display = 'block';
      tip.style.left = `${Math.min(mx + 10, (root.clientWidth || 320) - 190)}px`;
      tip.style.top = `${my + 10}px`;
    };

    svg.addEventListener('pointermove', onMove);
    svg.addEventListener(
      'pointerleave',
      () => (tip.style.display = 'none')
    );

    draw();
    return {
      update(next) {
        current = next;
        draw();
      },
      destroy() {
        svg.removeEventListener('pointermove', onMove);
        root.remove();
      },
    };
  },
};
