import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Parallel-coordinates mining node — every film a polyline across eight
 * numeric axes (year, budget, revenue, ROI, rating, popularity, votes,
 * runtime). Lives downstream of SurfaceRegions and extends the Mining
 * lane: SurfaceRegions finds *rectangular* density spikes in any two
 * dimensions; this opens the *n-dimensional* view, where the human carves
 * the subset by dragging brushes on any combination of axes.
 *
 * Three roles in one node:
 *   - **viz**     ECharts parallel-coords chart with axis-area brushing
 *                 (`<dragmouse>` on any axis to define an interval).
 *   - **event**   `axisareaselected` from the chart is posted back via a
 *                 hidden form (the only generic shim path); we collect
 *                 the full multi-axis brush state, write it to a flow-
 *                 relative side-file, and `markStale()`.
 *   - **transform** on next pull, `process` re-reads the side-file and
 *                 emits a `selected` port (films matching every brush) —
 *                 ready to wire into GenerateTopLists.movies for "top-N
 *                 inside the carved region".
 *
 * Brush state is durable per-flow (lives in `_pc_brush.json` next to
 * cocoon.yml). `movies` is passed through unchanged so further nodes in
 * the Mining chain can be wired off it.
 *
 * Symmetric-import: this module exports a `hook`, so the only top-level
 * imports are `import type` + relative paths. `node:fs/promises` is
 * dynamic-imported inside `process` / `control.data` / `control.event`.
 */

interface MovieRow {
  id: number;
  title: string;
  release_year: number;
  popularity: number;
  vote_average: number;
  vote_count: number;
  budget: number;
  revenue: number;
  runtime: number | null;
}

type AxisKey =
  | 'year'
  | 'budget'
  | 'revenue'
  | 'roi'
  | 'rating'
  | 'popularity'
  | 'votes'
  | 'runtime';

interface AxisDef {
  key: AxisKey;
  label: string;
  scale: 'linear' | 'log';
  get: (m: MovieRow) => number | null;
  fmt: (v: number) => string;
}

const AXES: AxisDef[] = [
  {
    key: 'year',
    label: 'Year',
    scale: 'linear',
    get: m => (m.release_year > 1900 ? m.release_year : null),
    fmt: v => String(Math.round(v)),
  },
  {
    key: 'budget',
    label: 'Budget ($)',
    scale: 'log',
    get: m => (m.budget > 0 ? m.budget : null),
    fmt: v => fmtMoney(v),
  },
  {
    key: 'revenue',
    label: 'Revenue ($)',
    scale: 'log',
    get: m => (m.revenue > 0 ? m.revenue : null),
    fmt: v => fmtMoney(v),
  },
  {
    key: 'roi',
    label: 'ROI (×)',
    scale: 'log',
    get: m =>
      m.budget > 0 && m.revenue > 0 ? m.revenue / m.budget : null,
    fmt: v => `${v.toFixed(2)}×`,
  },
  {
    key: 'rating',
    label: 'Rating (★)',
    scale: 'linear',
    get: m => (m.vote_average > 0 ? m.vote_average : null),
    fmt: v => v.toFixed(1),
  },
  {
    key: 'popularity',
    label: 'Popularity',
    scale: 'log',
    get: m => (m.popularity > 0 ? m.popularity : null),
    fmt: v => v.toFixed(1),
  },
  {
    key: 'votes',
    label: 'Votes',
    scale: 'log',
    get: m => (m.vote_count > 0 ? m.vote_count : null),
    fmt: v => Math.round(v).toLocaleString(),
  },
  {
    key: 'runtime',
    label: 'Runtime (min)',
    scale: 'linear',
    get: m => ((m.runtime ?? 0) > 0 ? (m.runtime as number) : null),
    fmt: v => `${Math.round(v)}m`,
  },
];

interface Range {
  axis: AxisKey;
  lo: number;
  hi: number;
}

interface BrushFile {
  ranges: Range[];
}

interface Point {
  id: number;
  title: string;
  year: number;
  /** Length = AXES.length; null = missing on that axis. */
  values: Array<number | null>;
}

interface AxisInfo {
  key: AxisKey;
  label: string;
  scale: 'linear' | 'log';
}

interface PCData {
  ready: boolean;
  axes: AxisInfo[];
  points: Point[];
  total: number;
  sampled: number;
  /** Live brush match — recomputed in data() on every event. */
  selectedCount: number;
  /** Last committed (pulled) selection size — only changes on re-run. */
  committedCount: number;
  brush: BrushFile;
  topSelected: Array<{
    id: number;
    title: string;
    year: number;
    rating: number;
    popularity: number;
  }>;
}

const BRUSH_FILE = '_pc_brush.json';
const MAX_POINTS = 2000;

// Dynamic import wrapper — keeps the symmetric-import rule (a node that
// also exports `hook` must not pull `node:*` at module top level).
const nodeImport = (s: string) => import(/* @vite-ignore */ s);

export const ParallelCoordinates: CocoonProcessNode = {
  category: 'TMDB',
  description:
    'Parallel coordinates — every film a polyline; brush axes to carve a subset emitted on `selected`.',

  async *process(ctx) {
    // Pass through every input port unchanged so the node is transparent to
    // anything wired in beyond `movies` (downstream consumers can still pull
    // a sibling port through without going around us). Then add `selected`:
    // `movies` ∩ brush — the carved subset, the value-add of this node.
    const inputs = ctx.ports.read();
    const movies = inputs.movies as MovieRow[] | undefined;
    const rows = Array.isArray(movies) ? movies : [];
    const brush = await readBrush(ctx);
    const selected = rows.filter(m => matchesBrush(m, brush.ranges));
    ctx.ports.write({ ...inputs, movies: rows, selected });
    const rs = brush.ranges.length;
    return `${rows.length} films · ${rs} brush${rs === 1 ? '' : 'es'} · ${selected.length} selected`;
  },

  control: {
    window: { width: 1040, height: 720 },

    async data(ctx): Promise<PCData> {
      const rows = (ctx.output.movies as MovieRow[] | undefined) ?? [];
      const brush = await readBrush(ctx);

      // Re-derive the filter LIVE from the current brush — the durable
      // truth between pulls. `ctx.output.selected` is the committed port
      // (only refreshed on re-run), used to show pull-vs-live drift.
      const liveSelected = brush.ranges.length
        ? rows.filter(m => matchesBrush(m, brush.ranges))
        : rows;
      const committed =
        (ctx.output.selected as MovieRow[] | undefined) ?? rows;

      const sampled = stridedSample(rows, MAX_POINTS);
      const points: Point[] = sampled.map(m => ({
        id: m.id,
        title: m.title,
        year: m.release_year,
        values: AXES.map(a => a.get(m)),
      }));

      const topSelected = [...liveSelected]
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, 8)
        .map(m => ({
          id: m.id,
          title: m.title,
          year: m.release_year,
          rating: m.vote_average,
          popularity: m.popularity,
        }));

      return {
        ready: rows.length > 0,
        axes: AXES.map(a => ({ key: a.key, label: a.label, scale: a.scale })),
        points,
        total: rows.length,
        sampled: points.length,
        selectedCount: liveSelected.length,
        committedCount: committed.length,
        brush,
        topSelected,
      };
    },

    render(ctx) {
      const d = ctx.data as PCData | undefined;
      const compact = ctx.surface === 'node';

      if (!d?.ready) {
        return compact
          ? `${STYLE}<div class="pc-compact"><strong>ParallelCoords</strong><p>pull upstream first</p>
  <button data-cocoon-event="$open">Open ▸</button></div>`
          : `${STYLE}<div class="pc"><p class="empty">No films — pull SurfaceRegions upstream.</p></div>`;
      }

      const rs = d.brush.ranges.length;

      if (compact) {
        return `${STYLE}<div class="pc-compact">
  <strong>${d.axes.length} axes</strong>
  <p>${d.total} films · ${rs} brush${rs === 1 ? '' : 'es'} · <b>${d.selectedCount}</b> in selection</p>
  <button data-cocoon-event="$open">Open chart ▸</button>
</div>`;
      }

      const axisFmt: Record<AxisKey, AxisDef['fmt']> = Object.fromEntries(
        AXES.map(a => [a.key, a.fmt])
      ) as Record<AxisKey, AxisDef['fmt']>;
      const axisLabel: Record<AxisKey, string> = Object.fromEntries(
        AXES.map(a => [a.key, a.label])
      ) as Record<AxisKey, string>;

      const rangeRows = rs
        ? d.brush.ranges
            .map(
              r => `<li>
    <span class="ax">${esc(axisLabel[r.axis])}</span>
    <span class="num">${esc(axisFmt[r.axis](r.lo))} – ${esc(axisFmt[r.axis](r.hi))}</span>
  </li>`
            )
            .join('\n')
        : `<li class="dim">drag on any axis to brush a range</li>`;

      const topRows = d.topSelected.length
        ? d.topSelected
            .map(
              t => `<li>
    <b>${esc(t.title)}</b> <span class="dim">(${t.year})</span>
    <span class="num">${t.rating.toFixed(1)}★ · pop ${t.popularity.toFixed(1)}</span>
  </li>`
            )
            .join('\n')
        : `<li class="dim">no selection — everything passes</li>`;

      return `${STYLE}<div class="pc">
  <header class="head">
    <h1>Parallel coordinates</h1>
    <p class="sub">${d.total} films · sampled <b>${d.sampled}</b> drawn · <b>${d.selectedCount}</b> in current brush${rs ? ` across ${rs} ax${rs === 1 ? 'is' : 'es'}` : ''}${d.selectedCount !== d.committedCount ? ` · <span class="pending">✎ pull to commit (${d.committedCount} on <code>selected</code> port)</span>` : ''}</p>
  </header>
  <div class="plot" data-cocoon-hook="ParallelCoordinates"></div>
  <div class="rows">
    <section class="card">
      <h2>Brush</h2>
      <ul class="ranges">${rangeRows}</ul>
      <form data-cocoon-event="clear" class="row-actions">
        <button type="submit">Clear all brushes</button>
        <span class="hint">↑ click ➜ re-pull to refresh <code>selected</code> downstream</span>
      </form>
    </section>
    <section class="card">
      <h2>Top selected (by popularity)</h2>
      <ul class="entries">${topRows}</ul>
    </section>
  </div>
</div>`;
    },

    async event(ctx, ev) {
      if (ev.event === '$mount') return;
      if (ev.event === 'brush') {
        const raw = (ev.payload as Record<string, unknown> | undefined)
          ?.ranges;
        let ranges: Range[] = [];
        if (typeof raw === 'string' && raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) ranges = parsed.filter(isRange);
          } catch {
            /* ignore malformed */
          }
        }
        await writeBrush(ctx, { ranges });
        ctx.markStale();
        return;
      }
      if (ev.event === 'clear') {
        await writeBrush(ctx, { ranges: [] });
        ctx.markStale();
        return;
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers (Node side).
// ---------------------------------------------------------------------------

async function readBrush(ctx: {
  resolvePath: (p?: string) => string;
}): Promise<BrushFile> {
  try {
    const fs = await nodeImport('node:fs/promises');
    const path = ctx.resolvePath(BRUSH_FILE);
    const txt = await fs.readFile(path, 'utf8');
    const j = JSON.parse(txt);
    if (j && Array.isArray(j.ranges))
      return { ranges: (j.ranges as unknown[]).filter(isRange) };
    return { ranges: [] };
  } catch {
    return { ranges: [] };
  }
}

async function writeBrush(
  ctx: { resolvePath: (p?: string) => string },
  b: BrushFile
): Promise<void> {
  const fs = await nodeImport('node:fs/promises');
  const path = ctx.resolvePath(BRUSH_FILE);
  await fs.writeFile(path, JSON.stringify(b, null, 2) + '\n', 'utf8');
}

function isRange(x: unknown): x is Range {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.axis === 'string' &&
    typeof r.lo === 'number' &&
    typeof r.hi === 'number' &&
    Number.isFinite(r.lo) &&
    Number.isFinite(r.hi) &&
    AXES.some(a => a.key === r.axis)
  );
}

function matchesBrush(m: MovieRow, ranges: Range[]): boolean {
  if (ranges.length === 0) return true;
  // Group by axis: within an axis, OR (any range matches); across axes, AND.
  const byAxis = new Map<AxisKey, Range[]>();
  for (const r of ranges) {
    const arr = byAxis.get(r.axis) ?? [];
    arr.push(r);
    byAxis.set(r.axis, arr);
  }
  for (const [axisKey, rs] of byAxis) {
    const def = AXES.find(a => a.key === axisKey);
    if (!def) continue;
    const v = def.get(m);
    if (v == null || !Number.isFinite(v)) return false;
    const ok = rs.some(r => v >= r.lo && v <= r.hi);
    if (!ok) return false;
  }
  return true;
}

function stridedSample<T>(rows: T[], cap: number): T[] {
  if (rows.length <= cap) return rows;
  const step = rows.length / cap;
  const out: T[] = [];
  for (let i = 0; i < rows.length && out.length < cap; i += step) {
    out.push(rows[Math.floor(i)]);
  }
  return out;
}

const fmtMoney = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${Math.round(v)}`;
};

const esc = (v: unknown): string =>
  String(v == null ? '' : v).replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!
  );

// ---------------------------------------------------------------------------
// Browser hook — ECharts parallel coords with native axis brushing.
// ---------------------------------------------------------------------------

interface EChartsInst {
  setOption: (o: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  on: (ev: string, cb: (params: unknown) => void) => void;
  off: (ev: string) => void;
  dispatchAction: (a: unknown) => void;
}

interface BrushEventParams {
  parallelAxisId?: string;
  intervals?: Array<[number, number]>;
}
interface EChartsMod {
  init: (el: HTMLElement, theme?: string) => EChartsInst;
}

export const hook: ControlHook<PCData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText =
      'width:100%;height:100%;min-height:340px;position:relative;';
    el.appendChild(root);

    // Hidden form — the only generic way a hook can post an event back
    // through the shim (which listens for submit/click via attribute
    // convention; programmatic submit bubbles to the same handler).
    const form = document.createElement('form');
    form.setAttribute('data-cocoon-event', 'brush');
    form.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;';
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'ranges';
    form.appendChild(hidden);
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    form.appendChild(submitBtn);
    el.appendChild(form);

    let data: PCData | undefined = props.data;
    let chart: EChartsInst | undefined;
    let echarts: EChartsMod | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let suppressEmit = false;
    // Wall-clock of the last brush event from the user — used to skip
    // dispatching a stale server echo back at the chart while they're still
    // mid-drag (would visually snap the brush back to the last-committed
    // position).
    let lastBrushEventTs = 0;
    // Split: `structureHash` (axes + sample size) drives full redraws;
    // `brushHash` (server's brush JSON) drives the lighter dispatchAction
    // path. A full setOption recreates echarts' brushController and visually
    // wipes existing covers, so we only do it when the chart shape changes.
    let lastStructureHash = '';
    let lastBrushHash = '';
    let listenerWired = false;

    // Per-axis brush intervals tracked from the `axisareaselected` event —
    // getOption() does NOT expose runtime brush state (it stays inside
    // echarts' brushController), so we accumulate them ourselves. Keyed by
    // our axis-index (== position in data.axes); we encode the index into
    // the explicit `id: 'pcaxis-<ix>'` we set on each parallelAxis so the
    // event's `parallelAxisId` round-trips back.
    const axisBrushes = new Map<number, Array<[number, number]>>();

    const seedAxisBrushesFromData = () => {
      axisBrushes.clear();
      if (!data) return;
      for (const r of data.brush.ranges) {
        const ix = data.axes.findIndex(a => a.key === r.axis);
        if (ix < 0) continue;
        const arr = axisBrushes.get(ix) ?? [];
        arr.push([r.lo, r.hi]);
        axisBrushes.set(ix, arr);
      }
    };

    const axisIdFor = (ix: number) => `pcaxis-${ix}`;
    const indexFromAxisId = (id: string | undefined): number => {
      if (!id) return -1;
      const m = /^pcaxis-(\d+)$/.exec(id);
      return m ? Number(m[1]) : -1;
    };

    const applyBrushesToChart = () => {
      if (!chart || !data) return;
      suppressEmit = true;
      // One dispatch per axis — empty intervals clear that axis's covers.
      for (let ix = 0; ix < data.axes.length; ix++) {
        const intervals = axisBrushes.get(ix) ?? [];
        chart.dispatchAction({
          type: 'axisAreaSelect',
          parallelAxisId: axisIdFor(ix),
          intervals,
        });
      }
      setTimeout(() => {
        suppressEmit = false;
      }, 180);
    };

    // Whether the server's brush already matches what we've tracked locally
    // from user drags — when true, the chart's visible brush is correct and
    // we don't need to dispatch (avoiding any flicker on echo of our own
    // emit). Only false on external changes (clear button, agent write, …).
    const serverMatchesLocal = (): boolean => {
      if (!data) return true;
      const serverByIx = new Map<number, Array<[number, number]>>();
      for (const r of data.brush.ranges) {
        const ix = data.axes.findIndex(a => a.key === r.axis);
        if (ix < 0) continue;
        const arr = serverByIx.get(ix) ?? [];
        arr.push([r.lo, r.hi]);
        serverByIx.set(ix, arr);
      }
      if (serverByIx.size !== axisBrushes.size) return false;
      for (const [ix, intervals] of axisBrushes) {
        const s = serverByIx.get(ix);
        if (!s || s.length !== intervals.length) return false;
        for (let i = 0; i < intervals.length; i++) {
          if (intervals[i][0] !== s[i][0] || intervals[i][1] !== s[i][1])
            return false;
        }
      }
      return true;
    };

    const draw = () => {
      if (!echarts || !data?.ready) return;
      if (!chart) chart = echarts.init(root, 'dark');

      const structureHash = `${data.points.length}|${data.axes.map(a => a.key).join(',')}`;
      const brushHash = JSON.stringify(data.brush.ranges);

      // Brush-only change: don't rebuild the chart; tell the brushController
      // to sync via the canonical action — but only if the change is external
      // (Clear button, agent write). Skip both when the server brush matches
      // our local map AND when the user is mid-drag (server echo arrives
      // ~300ms after emit; the user has typically dragged past it by then,
      // and dispatching the older state visually snaps the brush backwards).
      if (structureHash === lastStructureHash) {
        const activelyDragging = Date.now() - lastBrushEventTs < 600;
        if (
          brushHash !== lastBrushHash &&
          !activelyDragging &&
          !serverMatchesLocal()
        ) {
          seedAxisBrushesFromData();
          applyBrushesToChart();
        }
        lastBrushHash = brushHash;
        return;
      }
      lastStructureHash = structureHash;
      lastBrushHash = brushHash;

      seedAxisBrushesFromData();

      const axisOpts = data.axes.map((a, ix) => ({
        id: axisIdFor(ix),
        dim: ix,
        name: a.label,
        // ECharts axis types: 'value' | 'log' | 'category' | 'time'.
        // (`'linear'` would trigger a runtime "parallelAxis.linear not imported".)
        type: a.scale === 'log' ? 'log' : 'value',
        // Fit to data extent — otherwise value axes start at 0 ("Year" axis
        // showing 0–2,500 when films span 1900–2025). Ignored on log.
        scale: true,
        nameLocation: 'end' as const,
        nameRotate: 28,
        nameGap: 14,
        nameTextStyle: { color: '#c4b5fd', fontSize: 10 },
        axisLine: { lineStyle: { color: '#3c3c47' } },
        axisTick: { lineStyle: { color: '#3c3c47' } },
        axisLabel: { color: '#9a9aa6', fontSize: 9 },
        splitLine: { show: false },
        areaSelectStyle: {
          color: '#8b5cf6',
          borderColor: '#a78bfa',
          borderWidth: 1,
          opacity: 0.25,
        },
        areas: (axisBrushes.get(ix) ?? []).map(([lo, hi]) => ({
          interval: [lo, hi] as [number, number],
        })),
      }));

      suppressEmit = true;
      chart.setOption(
        {
          backgroundColor: 'transparent',
          animation: false,
          parallel: {
            left: 70,
            right: 70,
            top: 40,
            bottom: 30,
            parallelAxisDefault: { nameTruncate: { maxWidth: 90 } },
          },
          parallelAxis: axisOpts,
          series: [
            {
              name: 'films',
              type: 'parallel',
              lineStyle: { color: '#fbbf24', width: 0.7, opacity: 0.16 },
              // Progressive rendering on parallel-coords composites chunks
              // on every repaint (hover, resize) instead of clearing — the
              // visible result is lines stacking up under the cursor.
              // 2000 × 8 is tiny; draw it in one pass.
              progressive: 0,
              progressiveThreshold: Infinity,
              smooth: false,
              inactiveOpacity: 0.02,
              activeOpacity: 0.85,
              data: data.points.map(p => p.values),
            },
          ],
        },
        true
      );
      setTimeout(() => {
        suppressEmit = false;
      }, 180);

      if (!listenerWired) {
        chart.on('axisareaselected', (raw: unknown) => {
          if (suppressEmit) return;
          const params = raw as BrushEventParams;
          const ix = indexFromAxisId(params.parallelAxisId);
          if (ix < 0) return;
          const intervals = (params.intervals ?? [])
            .filter(iv => Array.isArray(iv) && iv.length >= 2)
            .map(iv => [Number(iv[0]), Number(iv[1])] as [number, number])
            .filter(iv => Number.isFinite(iv[0]) && Number.isFinite(iv[1]));
          if (intervals.length === 0) axisBrushes.delete(ix);
          else axisBrushes.set(ix, intervals);
          lastBrushEventTs = Date.now();
          scheduleEmit();
        });
        listenerWired = true;
      }
      chart.resize();
    };

    const scheduleEmit = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(emit, 220);
    };

    const emit = () => {
      if (!chart || !data) return;
      const ranges: Range[] = [];
      for (const [ix, intervals] of axisBrushes) {
        const axisKey = data.axes[ix]?.key;
        if (!axisKey) continue;
        for (const [a, b] of intervals) {
          ranges.push({
            axis: axisKey,
            lo: Math.min(a, b),
            hi: Math.max(a, b),
          });
        }
      }
      if (sameRanges(ranges, data.brush.ranges)) return;
      hidden.value = JSON.stringify(ranges);
      submitBtn.click();
    };

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(root);

    import('https://esm.sh/echarts@5.4.3')
      .then(m => {
        echarts = m as unknown as EChartsMod;
        draw();
      })
      .catch(err => {
        console.error('ParallelCoordinates hook failed:', err);
        root.innerHTML = `<pre style="color:#f97373;padding:12px;">ECharts failed to load: ${String(err)}</pre>`;
      });

    return {
      update(next) {
        data = (next.data as PCData | undefined) ?? data;
        draw();
      },
      destroy() {
        ro.disconnect();
        if (pending) clearTimeout(pending);
        chart?.dispose();
        root.remove();
        form.remove();
      },
    };
  },
};

function sameRanges(a: Range[], b: Range[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: Range) => `${r.axis}|${r.lo}|${r.hi}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((s, i) => s === sb[i]);
}

// ---------------------------------------------------------------------------

const STYLE = `<style>
.control .pc-compact { display:flex; flex-direction:column; gap:6px; }
.control .pc-compact strong { font-size:12px; color:#fb923c; }
.control .pc-compact p { margin:0; color:#9a9aa6; font-size:11px; font-variant-numeric:tabular-nums; }
.control .pc-compact p b { color:#c4b5fd; }
.control .pc-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .pc-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .pc {
  --card:#212128; --line:#303039; --muted:#9a9aa6;
  display:flex; flex-direction:column; gap:12px; height:100%; min-height:520px;
  color:#e7e7ea; font-size:11.5px;
}
.control .pc .head h1 { margin:0; font-size:15px; color:#fb923c; }
.control .pc .head .sub { margin:3px 0 0 0; color:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; }
.control .pc .head .sub b { color:#c4b5fd; }
.control .pc .head .sub .pending { color:#fbbf24; }
.control .pc .head .sub .pending code { color:#fbbf24; background:transparent; font-size:10.5px; }
.control .pc .plot { flex:1; min-height:340px; }
.control .pc .empty { color:var(--muted); font-style:italic; padding:20px; text-align:center; }

/* Bottom row + card heights are FIXED — otherwise the chart above
   reflows (yanking the brush) whenever the selection count changes the
   number of <li>s. The lists scroll internally instead. */
.control .pc .rows { display:grid; grid-template-columns:1fr 1fr; gap:12px; height:200px; flex:none; }
.control .pc .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; min-height:0; overflow:hidden; }
.control .pc .card h2 { margin:0; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); flex:none; }
.control .pc .card ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:5px; overflow:auto; flex:1; min-height:0; }
.control .pc .card li { display:flex; justify-content:space-between; gap:8px; align-items:baseline; font-variant-numeric:tabular-nums; }
.control .pc .card li.dim, .control .pc .card .dim { color:#71717a; font-style:italic; }
.control .pc .card .ax { color:#c4b5fd; }
.control .pc .card .num { color:#a5b4fc; font-size:11px; }
.control .pc .card b { color:#e7e7ea; font-weight:600; }
.control .pc .row-actions { display:flex; flex-direction:row; align-items:center; gap:10px; margin-top:2px; }
.control .pc .row-actions button { background:#27272a; border:1px solid #3f3f46; color:#e7e7ea; padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; }
.control .pc .row-actions button:hover { background:#3f3f46; }
.control .pc .row-actions .hint { color:#71717a; font-size:10.5px; }
.control .pc .row-actions code { color:#c4b5fd; font-size:10.5px; }
</style>`;
