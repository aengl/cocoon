# Cocoon — Svelte Flow prototype

The active rebuild for the Cocoon revival, deliberately **isolated from the
legacy `yarn`/`lerna` workspace** and its dead webpack/rollup toolchain. Editor
built with **Vite + Svelte 5 (runes) + TypeScript + `@xyflow/svelte`**; the
processing core is plain **Node.js + TypeScript run with no build step** (types
stripped at runtime). Package-managed with **pnpm**.

## Why this stack (decision record)

- **Svelte Flow over React Flow.** `@xyflow/svelte` v1 and `@xyflow/react` v12
  are co-released the same day by the same company under the same MIT-core /
  Pro-support model — maturity is not a differentiator. Svelte was chosen for
  long-term maintainer preference and to avoid buying deeper into the React
  ecosystem.
- **The render contract is framework-agnostic — and there is only one.** The
  original objection to Svelte was "the Views/plugins are React." Inspecting
  the code disproved it: legacy `CocoonView` already split into a pure data
  side (zero UI framework) and a render side that was the *only* React-bound
  thing — a single `=> JSX.Element` typedef. There is now **no separate View
  layer**: a visualisation is a *control* with a render hook and no `event`.
  The data side is `control.data` (core); the render side is
  `export const hook` (browser, `mount/update/destroy`, depending on
  nothing).

## Architecture

A standalone, transport-agnostic **Node core** (`core/`) owns the node
registry, processing and **all port data**. The browser editor is a *pure
viewer*: it loads the Cocoon file losslessly itself and receives only a stream
of per-node state (status / summary / per-port item counts / bounded control
payloads) over one WebSocket — never bulk data. The same core runs **headless**
from a CLI. This split is forced, not chosen: the browser sandbox can't do
`fs`/persist and the node library is authored as Node.js modules; remote-core
then works for free (it's just a WebSocket).

This prototype proves four theses:

1. **Svelte Flow replaces the bespoke graph chrome** (~3k lines of hand-rolled
   drag/SVG-edges/ports/zoom/grid in legacy `packages/editor/src/ui/`).
2. **Visualisations need neither React nor Svelte, and aren't a separate
   subsystem.** `src/lib/control-render.ts` is the sole `mount/update/destroy`
   `ControlHook` contract; the four legacy built-in views are ordinary nodes
   in `core/nodes/` (`Scatterplot`/`Inspector`/`Sparkline` = `control.data` +
   a zero-dep `hook` — the scatterplot replaces legacy ECharts with plain
   SVG; `Image` = render-only, no hook). `src/lib/controlAction.ts` is the
   entire generic Svelte shim. The pure `control.data` half runs in the core
   — only the bounded payload crosses the wire. (`sandbox/charts` exercises
   all four; `sandbox/tagcloud` proves a CDN-dep hook.)
3. **Graph ⇄ YAML round-trip** — `src/lib/definition.ts` maps a Cocoon
   definition file to/from Svelte Flow's plain serialisable arrays losslessly,
   matching Cocoon's "thin editor, core is source of truth" architecture.
4. **Real processing, end-to-end** — `simple-api` runs against the live USGS
   API (fetch → Map → Filter), with disk persist, a node-lifecycle status
   model (idle/queued/running/done/stale/error), edge item counts, and
   `Inspector`/`Scatterplot` visualisation nodes rendering streamed data.

## Run

```sh
cd prototype
pnpm install

# terminal 1 — the processing core (simple-api on ws://localhost:4000)
pnpm serve
# terminal 2 — the editor
pnpm dev
```

Open the editor and click a node (e.g. `MapValues`): it processes that node and
everything upstream, colours the lifecycle, labels edges with item counts, and
renders any control/visualisation the node declares. With no core running the
editor stays usable as an offline preview and shows a connect/launch panel.

Headless, no browser:

```sh
pnpm core run ../examples/simple-api/cocoon.yml \
  --target 'cocoon://MapValues/out/data' --format table
```

Other scripts: `pnpm check` (svelte-check) · `pnpm test` (vitest back-compat
over all 7 real examples) · `pnpm build` · `pnpm core serve <file> [--port N]`.

## Not yet (out of scope for the prototype)

- Multi-control brushing & linking across connected nodes (the WS layer +
  presence channel it lives in exist; the sync does not)
- Helper-line snapping (auto-layout via `dagre` is in)
- single-file-HTML editor bundle + `web+cocoon://` deep-link; richer AI
  surface (CLI+stdout is in, MCP wrapper later); Scatterplot preview sampling
  for very large datasets
