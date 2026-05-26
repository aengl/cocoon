# Writing charts (and picking the right library)

Companion to `SKILL.md` and `writing-nodes.md`. Read those first — this assumes you already know what a control + hook looks like, the symmetric-import rule, and how to locate the Cocoon repo (SKILL.md's "Finding the Cocoon repo" note). The reference impls behind every claim here live inside that repo at `examples/charts/` (one node per library) and `examples/bgg/nodes/DeltaScatter.ts` / `examples/tmdb/nodes/ParallelCoordinates.ts` (the in-the-wild ECharts examples).

A chart in Cocoon is just a render-only control with an `export const hook`. There is no chart framework, no "viz subsystem", no registry — `control.data` bounds the payload, `control.render` returns a `<div data-cocoon-hook="…">` placeholder, and the browser hook lazy-imports a charting library from a CDN and mounts into the div. Picking a library is therefore the *only* interesting decision. This file is the picker.

## 1 — The integration contract every chart node honours

Every chart-bearing node looks the same shape on disk; the library differs only inside `mount()`:

```ts
// nodes/MyChart.ts
import type { CocoonProcessNode, ControlHook } from '<core>/contract.ts';

interface ChartData { ready: boolean; /* … bounded payload … */ }

export const MyChart: CocoonProcessNode = {
  category: 'Charts',
  description: 'One line for the inspector.',
  // optional steering: dimension/colour/binning that changes the EMITTED data
  controls: { /* … */ },

  async *process(ctx) { /* derive bounded points + write to ports */ },

  control: {
    window: { width: 720, height: 560 },          // initial detached size
    data(ctx)   { return ctx.output.chart as ChartData ?? FALLBACK; },
    render(ctx) {
      if (ctx.surface === 'node')  return COMPACT_HTML;
      return `${STYLE}<div class="my"><div class="plot" data-cocoon-hook="MyChart"></div></div>`;
    },
  },
};

export const hook: ControlHook<ChartData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:340px;';
    el.appendChild(root);

    let data = props.data;
    let chart: { setOption?(o: unknown): void; resize?(): void; destroy?(): void; dispose?(): void } | undefined;
    let lib: any;

    const draw = () => { if (!lib || !data?.ready) return; /* lib-specific draw */ };

    const ro = new ResizeObserver(() => chart?.resize?.());
    ro.observe(root);

    import('https://esm.sh/<library>@<pin>')
      .then(m => { lib = m; draw(); })
      .catch(err => { root.innerHTML = `<pre style="color:#f97373;padding:12px;">${String(err)}</pre>`; });

    return {
      update(next) { data = next.data; draw(); },
      destroy()    { ro.disconnect(); chart?.dispose?.(); chart?.destroy?.(); root.remove(); },
    };
  },
};
```

Five things the chart node owes the platform:

1. **Lazy CDN import inside `mount()`.** Top-level `import type` only — the symmetric-import rule. esbuild bundles `mount` for the browser, so a top-level bare specifier breaks the bundle.
2. **Bounded `control.data` payload.** A chart never sees the raw 150k-row port. Cap with a constant (`MAX_POINTS`, `STRIDE`, `BUCKETS`) and pre-aggregate / sample in `process` or `data`. The payload streams over WebSocket every event.
3. **`ResizeObserver` self-sizing.** The shim does not feed resize events back. Observe the root; call the library's resize/redraw.
4. **`destroy()` actually tears down.** Disconnect the observer, call the library's dispose/destroy, remove DOM. Hooks are mounted and unmounted; a leaked instance leaks memory in the editor for the session.
5. **Compact AND window branches.** The inline node surface is ~240×140; almost no chart looks right there. The compact surface should be a one-line summary + "Open ▸"; the window holds the actual chart.

## 2 — Decision matrix (read this first)

Pick by the constraint that hurts most. **ECharts is the default**; deviate only when you need something it can't do well.

| Need | Library | Why |
|---|---|---|
| **Just plot something** — any common chart, dark theme, mouse-rich | **ECharts** | Largest chart catalogue, best dark theme, decent perf to ~50k points |
| **Faceted small multiples / exploratory grid** | **Observable Plot** | Plot's `fx`/`fy` + marks is the cleanest grid-of-plots API anywhere |
| **A truly custom layout** (chord, beeswarm, sankey w/ tweaks, radial trees) | **D3** | No abstraction tax; you're writing the layout |
| **Linked-brush crossfilter** / declarative interaction grammar | **Vega-Lite** | Selections + parameters + interval brushes are first-class JSON |
| **3D surface / contour / scientific** | **Plotly.js** | Only one of these with good 3D out of the box |
| **Millions of timeseries points** at 60fps | **uPlot** | Canvas, ~10kB, beats everything for raw point throughput |
| **Embarrassingly simple: pie / bar / line / radar** | **Chart.js** | Smallest API surface; bigger team won't bikeshed |
| **Network graph / force layout / clusters** | **Cytoscape.js** | The standard outside academia; has layouts D3-force lacks |
| **Geo / hex heatmap / >1M points on a map** | **deck.gl** | WebGL; ECharts geo tops out way before this |
| **3D scene / particles / non-chart 3D** | **Three.js** | Not a chart lib, but covers the gap |
| **HTML/SVG-native, hand-built** | (no library) | A `<table>`, `<svg>`, or `<div>` grid IS valid. Don't reach for a lib if the chart is 30 lines of SVG. |

Heuristics that override the table:

- **A chart with steering inputs that affect what's plotted** → the knob is a *steering control* on `process`, not a chart-library setting. Cf. `examples/bgg/nodes/DeltaScatter.ts` `.controls.dimension` — the chart's x-axis IS the steering output.
- **Brushing back into the pipeline** → does NOT need a brush-native library. Any library that fires a selection callback works. The Cocoon model is: the brush state lives in the node (module-scoped Map, see `examples/tmdb/nodes/ParallelCoordinates.ts`), `control.event` writes it + `markStale`, `process` reads it on next pull to emit a `selected` port. Vega-Lite is a nice fit because its brush state is already JSON, but it isn't required.
- **A chart is a viz, not an action** → no `event` handler. The render-only pattern keeps "this is a view of upstream data" obvious to readers.
- **If you ever need TWO libraries in one node** → split the node. Cocoon's whole shape rewards one-job-per-node; a viz and a control panel are two nodes and an edge.

## 3 — The libraries

Each section: **what it's good at · chart types · perf envelope · interactivity · brushing · CDN pin · gotchas**. The "standout demo" line points at the node in `examples/charts/nodes/` that exercises the library at its best.

### ECharts — the default

**Standout demo:** `examples/charts/nodes/EChartsSankey.ts` (the chart type ECharts owns categorically — flow-graph layouts with hover-glow links + curved bezier edges).

- **Good at:** the broadest chart catalogue of any library here, in one consistent API, with a built-in dark theme that matches Cocoon's palette out of the box.
- **Chart types:** scatter, line, bar, pie, sunburst, sankey, treemap, heatmap, candlestick, boxplot, gauge, radar, parallel coords, graph (force/circular), tree, calendar, geo, themeRiver, funnel, pictorial. Full catalogue (static HTML cheat sheet, deep-links into `option.html`): https://echarts.apache.org/en/cheat-sheet.html
- **Perf:** canvas renderer to ~50k points smoothly, ~200k with `progressive` set. Falls over before WebGL libs but beats everything SVG-based.
- **Interactivity:** mouse-rich by default — hover tooltips, legend toggles, axis brush (`dataZoom`), animation. All optional, all configurable.
- **Brushing:** native (`brush` component) — fires `brushSelected` with array of selected indices per series. Axis-area brushing in parallel coords also native.
- **CDN:** `import('https://esm.sh/echarts@5.4.3')` — call `m.init(root, 'dark')`.
- **Gotchas:** the option object can get big; favour readability over compactness (every option is well-named). Custom tooltips need an HTML formatter; remember to `esc()` inputs.

### Observable Plot — the declarative grammar (Mike Bostock's successor to D3 charts)

**Standout demo:** `examples/charts/nodes/PlotFaceted.ts` (Plot's killer feature is `fx`/`fy` faceting — a grid of small multiples in one declarative spec).

- **Good at:** "I have tidy data, give me the right chart" — short, composable, lifts off the page.
- **Chart types:** dot, line, area, bar, rect, cell, hexagon, contour, density, vector, text, ruleX/Y. Composable: any mark + any scale + facets. Full mark catalogue: https://observablehq.com/plot/features/marks
- **Perf:** SVG; budget under 5k marks for smoothness, with strategic `canvas: true` on dot/rect for higher.
- **Interactivity:** lighter than ECharts — tooltips via the `tip` mark, but no built-in zoom/pan. For interaction you compose Plot with vanilla DOM listeners or fall back to D3 / Vega-Lite.
- **Brushing:** not built-in; you handle pointer events on the resulting SVG and re-render. If you need brushing-first, prefer Vega-Lite.
- **CDN:** `import('https://esm.sh/@observablehq/plot@0.6.16')`. Plot uses D3 internally; the CDN bundle includes it.
- **Gotchas:** Plot returns an SVG node; replace, don't append (`root.replaceChildren(Plot.plot({...}))`). The `tip` mark needs a `channel` setup; the docs are essential.

### D3 — the raw-layout escape hatch

**Standout demo:** `examples/charts/nodes/D3Beeswarm.ts` (one of the few common charts no high-level lib does well — non-overlapping dot clusters by group via `d3.forceSimulation`).

- **Good at:** anything the higher-level libraries can't or won't draw. The data-binding model + scale + layout primitives are still unmatched. Use when you've sketched a chart on paper and no library has it as a preset.
- **Chart types:** anything. Standard charts via marks-by-hand (axis, scale, line, area, arc, rect). Layouts: force, chord, treemap, partition, pack, sankey, tree, voronoi, hierarchy. Full module list + gallery: https://d3js.org/
- **Perf:** SVG by default. Hand-rolled canvas keeps up with 100k+ marks.
- **Interactivity:** raw — wire pointer events to selections by hand. The flexibility is the point.
- **Brushing:** `d3.brush` / `d3.brushX` / `d3.brushY` — emits selection rectangles you handle.
- **CDN:** `import('https://esm.sh/d3@7.9.0')`. Tree-shake by importing sub-modules if bundle size matters in dev (`d3-scale`, `d3-force`, etc).
- **Gotchas:** the lib is verbose by design; budget more lines than you'd spend in ECharts. Don't reach for D3 if a preset library already does what you want — the maintenance gap is real.

### Vega-Lite — the interaction grammar

**Standout demo:** `examples/charts/nodes/VegaLiteBrush.ts` (declarative linked-brush crossfilter — drag-select on one chart, the others filter; Vega-Lite is the only lib where this is a JSON spec).

- **Good at:** declarative interaction — selections, parameters, predicates, linked views. Specs are JSON, easy to template from `control.data`, easy to round-trip back via `vegaEmbed`'s view API.
- **Chart types:** the grammar-of-graphics standard set (point, line, area, bar, rect, tick, rule, geoshape) plus composed views (layer/concat/repeat/facet). Full mark + view catalogue: https://vega.github.io/vega-lite/docs/mark.html
- **Perf:** canvas renderer available; budget similar to Observable Plot (a few thousand marks).
- **Interactivity:** first-class: interval selections, point selections, `bind`'d input widgets, `param`-driven everything.
- **Brushing:** the headline feature. Selection state is JSON; expose via `view.signal('brush')` after `vegaEmbed`. Round-trip into `controlEvent`.
- **CDN:** `import('https://esm.sh/vega-embed@6.26.0')` — bundles vega + vega-lite. Call `embed(el, spec, {actions:false, theme:'dark'})`.
- **Gotchas:** specs are JSON-only — no callbacks inside; signal handlers run after embed. Theme `'dark'` is decent but not perfect; tweak `config.background` and axis colours to match Cocoon. The wire bundle is heavy (~700kB gz) — fine for an opened window, not for the inline node surface.

### Plotly.js — the scientific specialty

**Standout demo:** `examples/charts/nodes/PlotlySurface.ts` (3D surface plot — the one common chart no other lib here does at all well).

- **Good at:** 3D (surface, mesh, isosurface), statistical (violin, contour, density), large scientific catalogues (heatmap variants, parallel-coords with brushing, ternary, sunburst). Strong default tooltips and a built-in toolbar.
- **Chart types:** ~40 trace types incl. scatter/line/bar/box/violin/heatmap/contour/scatter3d/surface/mesh3d/cone/streamtube/parcoords/sankey/treemap/sunburst/funnel/waterfall/geo/choropleth. Full reference: https://plotly.com/javascript/reference/index/
- **Perf:** mixed — WebGL traces (`scattergl`, `scatter3d`, `surface`) scale to 100k+ marks; SVG traces hit the same wall as Observable Plot.
- **Interactivity:** Plotly's modebar is built-in (pan/zoom/select/lasso/reset/save-png); hover tooltips just work.
- **Brushing:** `plotly_selected` event fires on box/lasso select; `plotly_relayout` on zoom.
- **CDN:** `import('https://esm.sh/plotly.js-dist-min@2.35.2')`. The `-dist-min` variant ships only the prebuilt bundle; ~3MB unzipped.
- **Gotchas:** **bundle size is the worst here.** Use Plotly when you actually need 3D / contour; for 2D scatter/line, ECharts is smaller and prettier. The dark theme needs manual layout (`paper_bgcolor`, `plot_bgcolor`, font colours).

### uPlot — the speed specialist

**Standout demo:** `examples/charts/nodes/UPlotMillion.ts` (1M-point timeseries at 60fps — uPlot's whole reason to exist).

- **Good at:** dense timeseries. Canvas-only, hyper-optimised, ~10kB minified. Mouse cursor, legend, scale-sync between charts, all built in.
- **Chart types:** line, area, bar, points — and that's it. README + feature list: https://github.com/leeoniya/uPlot
- **Perf:** the best on this list. ~1M points in <50ms initial draw; pan/zoom stays smooth at 60fps with strategic subsampling above 2M.
- **Interactivity:** crosshair cursor, drag-to-zoom (both axes), shift-drag-to-pan, double-click to reset, native legend hover. Sync cursor across multiple charts via the `sync` option — built-in.
- **Brushing:** the cursor *is* the interaction; selection range available via the cursor signal.
- **CDN:** `import('https://esm.sh/uplot@1.6.31')` plus its CSS at `https://esm.sh/uplot@1.6.31/dist/uPlot.min.css`. Load the CSS via `<link>` injection inside `mount`.
- **Gotchas:** data format is `[xs, ys, ...]` columnar, NOT `[{x,y},…]`. Bring a transform helper. uPlot has no `dispose()` — call `chart.destroy()`.

### Chart.js — the simple default

**Standout demo:** `examples/charts/nodes/ChartJsRadar.ts` (radar/polar — a chart Chart.js draws cleanly that's noticeably uglier in ECharts).

- **Good at:** the simplest possible API for the simplest possible charts. Defaults are sensible; the tooltip/legend/animation behave without configuration. Big team, big install base, predictable.
- **Chart types:** line, bar, radar, polarArea, doughnut, pie, scatter, bubble. Plus mixed-type and time-scale via adapters. Full chart-types reference: https://www.chartjs.org/docs/latest/charts/line.html (the `/charts/` index is a Vuepress SPA WebFetch can't read; the per-type pages render and their sidebar names every sibling — swap `line.html` for `bar.html`, `radar.html`, `polar.html`, `doughnut.html`, `bubble.html`, `scatter.html`).
- **Perf:** canvas; comparable to ECharts up to ~20k points, falls behind above.
- **Interactivity:** hover tooltips and legend toggles built-in. Pan/zoom is a separate plugin.
- **Brushing:** not built-in — needs `chartjs-plugin-zoom` for box-select, and even then the selection callback shape is rough. If brushing matters, look elsewhere.
- **CDN:** `import('https://esm.sh/chart.js@4.4.6/auto')` — `/auto` pre-registers every chart type so you don't have to call `Chart.register(...)`.
- **Gotchas:** the per-dataset/per-element `borderColor`/`backgroundColor` knobs are the only way to theme — there is no global dark theme like ECharts'. Cf. the demo for the standard zinc/violet override block.

### Cytoscape.js — the graph/network specialist

**Standout demo:** `examples/charts/nodes/CytoscapeForce.ts` (force-directed network with clustered colouring and hover-highlight neighbours).

- **Good at:** graph topology — nodes + edges with layout algorithms, selectors, highlighting, picking. Has the *largest* preset-layout catalogue (force, circular, hierarchical, grid, concentric, breadthfirst, cose-bilkent, klay, fcose, dagre).
- **Chart types:** one — graphs. But many layouts. Full layout + style reference: https://js.cytoscape.org/ (single huge page; WebFetch with a focused prompt — "list built-in layouts" / "node style properties" / etc.)
- **Perf:** canvas; smooth to ~5k nodes with default force layouts, ~20k+ with `fcose`/`cola` and headless layout (precompute positions in `process`, ship coordinates to the hook).
- **Interactivity:** click, drag, hover, panning, zoom, tap. `cy.on('tap', 'node', …)` style. Selectors (`'node[?weight]'`) work like jQuery for graphs.
- **Brushing:** box-select via `boxSelectionEnabled: true`; fires `boxselect` with selected elements.
- **CDN:** `import('https://esm.sh/cytoscape@3.30.4')`. Extension layouts (fcose, klay, cola, dagre) each have their own CDN pin and need `cytoscape.use()`.
- **Gotchas:** the default `cose` layout is slow and ugly above ~500 nodes — prefer `fcose` (extension) for anything non-trivial. Layout is async; gate the initial fit on `layout.run()` completion.

### Honourable mentions (in the guide; not demoed in `examples/charts/`)

- **deck.gl** — WebGL massive scale (>1M points), geo overlays, hex heatmaps, scatterplot at city/continent scale. Heavier API than the rest, but the only sane pick for geographic / huge-scale data. CDN: `https://esm.sh/@deck.gl/core@9.0.31` + sub-packages. Pair with `maplibre-gl` for basemap.
- **Three.js** — not a chart library, but the gap-filler for 3D scenes, particle systems, custom 3D vis. CDN: `https://esm.sh/three@0.169.0`.
- **Sigma.js** / **vis-network** — alternatives to Cytoscape; lighter API, smaller catalogue. Pick Cytoscape unless their specific defaults appeal.
- **AntV G2 / G2Plot** — Alibaba's grammar-of-graphics stack. Excellent and popular in CN; ECharts already wins for this codebase.
- **Highcharts / AG Charts** — commercial license. Skip unless legal has signed off.
- **visx / Recharts / Nivo / @nivo/* / react-chartjs-2** — React-only wrappers. Cocoon hooks are vanilla DOM; these don't apply.

## 4 — Brushing & linking the Cocoon way

The brushing-back-into-the-pipeline pattern doesn't care which library you used. The shape is established in `examples/tmdb/nodes/ParallelCoordinates.ts` and works for any lib that fires a selection callback:

```ts
// Module-scoped per-node brush state. Lives in JS memory; resets on serve
// restart / node-code edit. Brush is exploratory, not durable — by design.
const BRUSH = new Map<string, Brush>();
const readBrush  = (ctx: { nodeId: string }) => BRUSH.get(ctx.nodeId) ?? EMPTY;
const writeBrush = (ctx: { nodeId: string }, b: Brush) => BRUSH.set(ctx.nodeId, b);
```

Lifecycle:

1. **Hook → shim → `event`**: the hook attaches a library-specific brush callback. On change, it posts via a hidden form: `<form data-cocoon-event="brush"><input type="hidden" name="state" value='…json…'></form>` + `requestSubmit()`. Or, for richer payloads, use the JS shim path `window.__cocoonControl.postEvent(nodeId, 'brush', {…})` (cf. ParallelCoordinates).
2. **`event` handler**: parses, calls `writeBrush(ctx, state)`, calls `ctx.markStale()`. The handler does NOT round-trip the graph; `data()` will re-derive and re-render with the new brush.
3. **`data()`**: reads `readBrush(ctx)` every cycle, filters `ctx.output.movies` live, returns both the **live** count and the **committed** count (last pulled). The drift between them is the "unsaved selection" signal.
4. **`process()`**: on next pull, reads `readBrush(ctx)`, emits a `selected` port with the filtered subset. Downstream nodes consume `selected` as a normal edge.

A pure-viz chart (no event handler) is the render-only case — keep it that way to signal "no upstream-mutation here". The lift to brushing is adding a `brush` event handler + writing the module Map; the chart library's role is only "fire a callback with the selection".

## 5 — Performance budgets

The bottlenecks in order of how often they hurt:

1. **Wire payload (`controlData`).** Streams over WebSocket every event and every pull. **Cap the payload, always.** A `const MAX = 2000` at the top of the file + a `stridedSample` helper is the standard pattern (cf. `examples/tmdb/nodes/ParallelCoordinates.ts` `MAX_POINTS`). Charts that *display* aggregations should aggregate in `process`/`data`, not ship raw rows.
2. **Library bundle download.** First mount triggers a CDN fetch; `esm.sh` is fast but Plotly is still ~1MB on the wire. Pinning helps the browser cache hit on subsequent loads.
3. **Render throughput.** SVG dies around 5–10k marks. Canvas (ECharts, Chart.js, uPlot) holds tens of thousands. WebGL (Plotly's `*gl` traces, deck.gl) goes to millions.
4. **`update()` churn.** Don't tear down the chart in `update`; do `chart.setOption(newOption)` / `chart.setData(...)` / `chart.update()`. The hook contract is "swap data in place"; the library should keep its DOM/canvas.

If your chart re-creates instead of updates on every `controlData` change, you'll see the canvas flicker. Hold the chart instance in a closure outside `draw()` and call the library's incremental API.

## 6 — Theming (dark by default)

Cocoon's palette (zinc + violet/orange/amber accents, see `writing-nodes.md` §6) is the baseline. Library-specific notes:

- **ECharts**: `echarts.init(root, 'dark')` gets you 80% there; tweak only tooltip + axis if needed.
- **Observable Plot / Vega-Lite**: pass theme config inline. Vega's `theme: 'dark'` is decent; Plot needs colour overrides.
- **Plotly**: `layout: { paper_bgcolor:'transparent', plot_bgcolor:'transparent', font:{color:'#e7e7ea'} }`.
- **Chart.js / uPlot / D3 / Cytoscape**: hand-set colours from the zinc palette. The demos in `examples/charts/` carry a `COLORS` constant at the top — copy it.

Standard chart colours from the palette: violet `#8b5cf6` for primary series, amber `#fbbf24` for highlight/secondary, cyan `#22d3ee` and coral `#f97373` for +/- pairs, muted `#9a9aa6` for axis text, `#27272a` for split lines, transparent backgrounds.

## 7 — Anti-patterns

- **Don't draw from `render`.** `render` is sync and pure (no I/O, no DOM mutation). Emit a `<div data-cocoon-hook="…">` placeholder; the hook owns the canvas. Anything else fights the platform.
- **Don't ship raw data to the hook.** Bound in `data()`. A 50k-row port becomes a 2k stride-sampled summary before crossing the wire. If a chart legitimately needs the full thing, that's a sign the chart should be a downstream aggregation node, not a viz with a huge payload.
- **Don't recreate the chart on every update.** Hold the instance in the closure; the library's "set data" / "set option" path is always faster than mount + dispose.
- **Don't use steering controls for presentation.** A "colour scheme" knob is bake-it-in, not a `controls:` entry. Steering changes the *emitted* data (which rows, which dimension); presentation is a code constant. Cf. `writing-nodes.md` §2.
- **Don't mix two libraries in one node.** Each hook does one thing. If you need a heatmap *and* a network, split the node and edge them.
- **Don't use React/Vue/Svelte chart wrappers (visx, Recharts, Nivo, react-chartjs-2, chart.vue).** The hook is vanilla DOM by contract. Use the underlying vanilla lib directly.
- **Don't forget to `esc()` tooltip strings.** Library tooltips often take HTML strings; user-provided names land in attributes and innerHTML.
- **Don't leave the inline node surface chartless.** A 240px-wide chart-of-anything looks terrible. Show a one-line summary + "Open ▸"; the chart belongs in the window surface.
- **Clone `props.data` before handing it to a *mutating* chart lib.** Chart.js stashes `_meta` on datasets; Plotly mutates trace arrays for range caching. `props.data` arrives via Svelte 5's reactive controlData store — writing through that proxy throws `state_descriptors_fixed`. Pure-read libraries (ECharts, Observable Plot, D3, Vega-Lite, uPlot, Cytoscape) are fine; for the mutating ones, do `const safe = JSON.parse(JSON.stringify(data))` in `draw()` and feed `safe` to the library. (Don't reach for `structuredClone` — it can't handle Svelte's reactive proxies and throws `DataCloneError`.)

## 8 — A minimal chart scaffold (ECharts variant — the default pick)

```ts
import type { CocoonProcessNode, ControlHook } from '<core>/contract.ts';

interface Point { x: number; y: number; label: string; }
interface ChartData { ready: boolean; points: Point[]; n: number; }

const MAX_POINTS = 2000;

export const MyScatter: CocoonProcessNode = {
  category: 'Charts',
  description: 'Minimal ECharts scatter (template).',

  async *process(ctx) {
    const { rows } = ctx.ports.read() as { rows?: Array<Record<string, unknown>> };
    const data = (rows ?? []).slice(0, MAX_POINTS).map(r => ({
      x: Number(r.x), y: Number(r.y), label: String(r.label ?? ''),
    })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    ctx.ports.write({ chart: { ready: data.length > 0, points: data, n: data.length } });
    return `${data.length} points`;
  },

  control: {
    window: { width: 720, height: 540 },
    data(ctx): ChartData {
      return (ctx.output.chart as ChartData | undefined)
        ?? { ready: false, points: [], n: 0 };
    },
    render(ctx) {
      const d = ctx.data as ChartData;
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="my-compact">
  <strong>MyScatter</strong>
  <p>${d.ready ? `${d.n} points` : 'pull upstream'}</p>
  <button data-cocoon-event="$open">Open ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="my"><p class="empty">pull upstream first</p></div>`;
      return `${STYLE}<div class="my">
  <header class="head"><h1>MyScatter</h1><p class="sub">${d.n} points</p></header>
  <div class="plot" data-cocoon-hook="MyScatter"></div>
</div>`;
    },
  },
};

export const hook: ControlHook<ChartData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;min-height:340px;';
    el.appendChild(root);

    let data = props.data;
    let chart: { setOption(o: unknown): void; resize(): void; dispose(): void } | undefined;
    let echarts: { init(el: HTMLElement, theme?: string): typeof chart } | undefined;

    const draw = () => {
      if (!echarts || !data?.ready) return;
      if (!chart) chart = echarts.init(root, 'dark');
      chart!.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 56, right: 24, top: 24, bottom: 44 },
        tooltip: { trigger: 'item' },
        xAxis: { axisLabel: { color: '#9a9aa6' }, splitLine: { lineStyle: { color: '#27272a' } } },
        yAxis: { axisLabel: { color: '#9a9aa6' }, splitLine: { lineStyle: { color: '#27272a' } } },
        series: [{
          type: 'scatter', symbolSize: 7,
          itemStyle: { color: '#fbbf24', opacity: 0.75 },
          data: data.points.map(p => [p.x, p.y]),
        }],
      });
      chart!.resize();
    };

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(root);
    import('https://esm.sh/echarts@5.4.3').then(m => { echarts = m as typeof echarts; draw(); });

    return {
      update(next) { data = next.data; draw(); },
      destroy()    { ro.disconnect(); chart?.dispose(); root.remove(); },
    };
  },
};

const STYLE = `<style>
.control .my-compact { display:flex; flex-direction:column; gap:6px; }
.control .my-compact strong { font-size:12px; color:#fb923c; }
.control .my-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .my-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .my { display:flex; flex-direction:column; gap:10px; height:100%; min-height:380px; color:#e7e7ea; font-size:11.5px; }
.control .my .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .my .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .my .plot { flex:1; min-height:340px; }
.control .my .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
</style>`;
```

Swap the library import + `draw()` body and you have any of the eight demos in `examples/charts/`. Read those next.
