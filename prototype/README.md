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
- **The View layer is framework-agnostic.** The original objection to Svelte
  was "the Views/plugins are React." Inspecting the code disproved it: legacy
  `CocoonView` already splits into a pure data side (`serialiseViewData` /
  `respondToQuery`, zero UI framework) and a render side that was the *only*
  React-bound thing — a single `=> JSX.Element` typedef. `Echarts.tsx` is ~60
  lines of React lifecycle glue around imperative ECharts.

## Architecture

A standalone, transport-agnostic **Node core** (`core/`) owns the node
registry, processing and **all port data**. The browser editor is a *pure
viewer*: it loads the Cocoon file losslessly itself and receives only a stream
of per-node state (status / summary / per-port item counts / serialised view
payloads) over one WebSocket — never bulk data. The same core runs **headless**
from a CLI. This split is forced, not chosen: the browser sandbox can't do
`fs`/persist and the node library is authored as Node.js modules; remote-core
then works for free (it's just a WebSocket).

This prototype proves four theses:

1. **Svelte Flow replaces the bespoke graph chrome** (~3k lines of hand-rolled
   drag/SVG-edges/ports/zoom/grid in legacy `packages/editor/src/ui/`).
2. **Views need neither React nor Svelte.** `src/lib/view-contract.ts` is a
   `mount/update/destroy` contract; `src/lib/views/{sparkline,inspector,
   scatterplot}.ts` are interactive views with **zero framework deps** (the
   scatterplot replaces legacy ECharts with plain SVG); `src/lib/viewAction.ts`
   is the entire ~20-line Svelte shim. The pure `serialiseViewData` half runs
   in the core — only the reduced payload crosses the wire.
3. **Graph ⇄ YAML round-trip** — `src/lib/definition.ts` maps a Cocoon
   definition file to/from Svelte Flow's plain serialisable arrays losslessly,
   matching Cocoon's "thin editor, core is source of truth" architecture.
4. **Real processing, end-to-end** — `simple-api` runs against the live USGS
   API (fetch → Map → Filter), with disk persist, a node-lifecycle status
   model (idle/queued/running/done/stale/error), edge item counts, and the
   `Inspector` + `Scatterplot` views rendering streamed data.

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
renders the attached view. With no core running the editor stays usable as an
offline preview and shows a connect/launch panel.

Headless, no browser:

```sh
pnpm core run ../examples/simple-api/cocoon.yml \
  --target 'cocoon://MapValues/out/data' --format table
```

Other scripts: `pnpm check` (svelte-check) · `pnpm test` (vitest back-compat
over all 7 real examples) · `pnpm build` · `pnpm core serve <file> [--port N]`.

## Not yet (out of scope for the prototype)

- Multi-view brushing & linking across connected nodes (the WS layer it lives
  in exists; the sync does not)
- Auto-layout / helper-line snapping (wire `dagre`/`elkjs` later — both MIT)
- npm plugin resolution; single-file-HTML editor bundle + `web+cocoon://`
  deep-link; richer AI surface (CLI+stdout is in, WS/MCP wrappers later);
  Scatterplot preview sampling for very large datasets
