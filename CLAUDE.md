# Cocoon

Flow-based workflow automation & data visualisation: a dataflow graph defined
declaratively in YAML, edited visually, with interactive visualisations for
exploring large datasets. Not a replacement for Python/R/Bash/DB scripts —
a way to *unify and document* them. Inspired by KNIME.

Upstream: https://github.com/aengl/cocoon · npm `@cocoon/cocoon`.

## Status: revival

This is a ~10-year-old project (copy of the `2018 cocoon` archive, original
`.git` history intact) being revived. **All active work is in `prototype/`** —
a clean Svelte rebuild. The legacy `packages/` monorepo is kept *only* for
reference (its format, examples, and grammar are the compatibility target); it
is not being maintained or built.

## Core concepts

- **Node** — one data-processing operation; the unit of work. The node library
  is plain **JS** (or `.ts` with types stripped by Node at runtime — no build
  step). The YAML layer must therefore stay **registry-free**: it never depends
  on node-type port schemas, only on YAML structure.
- **Graph** — nodes wired into a dataflow, persisted as YAML (the "Cocoon
  definition file"). The editor is a view/controller; the processing instance
  is the source of truth.
- **View** — a visualisation attached to a node. **Framework-agnostic** (see
  decisions): a pure data side + an imperative render side.
- **Brushing & linking** — views on connected nodes synchronise. Lives in the
  WebSocket/IPC layer, *independent of the UI framework* (multi-view sync still
  deferred; the layer it lives in is built).
- **Architecture split** — *implemented.* A standalone, transport-agnostic
  Node **core** (`prototype/core/`) owns the registry, processing and **all
  port data**. The browser editor is a pure viewer that loads the file
  losslessly itself and receives only a stream of per-node *state* (status /
  summary / per-port counts / serialised view payloads) over one WebSocket —
  never bulk data. The same core is driven headless by a CLI (`cocoon run
  … --target cocoon://N/out/p` → stdout). Forced, not chosen: the browser
  sandbox can't do `fs`/persist and the node library is authored as Node.js
  modules. Remote-core works for free (it's just a WebSocket).

## Key decisions (architectural keystones)

1. **Svelte 5 + Svelte Flow, not React.** `@xyflow/svelte` v1 and
   `@xyflow/react` v12 are co-released the same day by the same company under
   the same MIT-core / Pro-(examples+support only, no gated features) model —
   maturity is *not* a differentiator. Chosen for long-term maintainer
   preference and to avoid deeper React lock-in.
2. **The View layer is framework-agnostic.** The objection "Views/plugins are
   React" was disproved by reading the legacy code: `CocoonView` already splits
   into a pure data side (`serialiseViewData`/`respondToQuery`, zero UI
   framework) and a render side that was the *only* React-bound thing — a
   single `=> JSX.Element` typedef. Replaced with an imperative
   `mount/update/destroy` contract (`prototype/src/lib/view-contract.ts`). A
   view depends on nothing (ECharts/D3/canvas/DOM/React/Svelte all fine). The
   entire cost of the framework choice is the ~20-line Svelte action
   (`viewAction.ts`) — compare legacy `Echarts.tsx`'s ~60 lines of React
   lifecycle. `views/sparkline.ts` is the zero-dependency reference impl;
   `views/inspector.ts` (collapsible tree) and `views/scatterplot.ts`
   (zero-dep SVG, replacing legacy ECharts) are real views following it. The
   pure `serialiseViewData` half runs in the **core**, so only the reduced
   payload crosses the wire; the browser runs only the render half. Proven
   end-to-end by `simple-api`'s `Inspector` + `Scatterplot`.
3. **Backwards-compatible YAML is mandatory.** Existing `examples/*/cocoon.yml`
   must load and round-trip losslessly (see contract below). No in-app text
   editor — the graph editor is designed to sit side-by-side with a real text
   editor, so round-trips must not churn hand-edited files.
4. **The prototype is isolated.** Lives in `prototype/`, pnpm, Vite, fresh
   toolchain — deliberately outside the dead yarn/lerna workspace.

## YAML backwards-compat contract

The grammar is ported **verbatim** from legacy `@cocoon/util` (regexes copied
exactly — do not "improve" them; they define compatibility):

- **Port reference / edge:** an `in` value (or array element) matching
  `/cocoon:\/\/(?<id>[^\/]+)\/(?<inout>[^\/]+)\/(?<port>.+)/` is an edge
  (`id`.`port` → thisNode.`inKey`). Non-matching `in` values are **literal
  params** (code strings, nested objects/arrays) and are preserved untouched.
  Writer always emits `cocoon://<id>/out/<port>`.
- **View string:** `/(?<inout>[^\/]+)\/(?<port>[^\/]+)\/(?<type>.+)/` →
  e.g. `out/data/Inspector`; a bare string (`Scatterplot`) is type-only.
- **CocoonFile root:** `env?`, `description?`, `nodes`, plus any unknown
  top-level keys — all preserved.
- **Node def:** `'?'`/`description` (docs), `editor:{actions?,col?,row?}`
  (a **grid**, not pixels), `in`, `out`, `persist`, `type` (required), `view`,
  `viewState`.
- **Lossless rule:** the editor *owns only* (a) `in:` edge references and
  (b) `editor.col/row`. The serializer deep-clones the parsed file and mutates
  only those; everything else passes through verbatim. Grid↔pixel via
  `COL_W=320 / ROW_H=240`. `editor` is written back only if it already existed
  or the node was actually moved (no churn on untouched files).
- Back-compat tests read the **canonical repo `examples/*/cocoon.yml`** (single
  source of truth) via Vite `server.fs.allow:['..']`; the app loads the same
  files via `import.meta.glob(..., '?raw')`.

## Layout

`prototype/` (active):
- `src/lib/cocoon-uri.ts` — faithful grammar ports (`parseCocoonUri`,
  `parseViewString`). Shared by editor + core.
- `src/lib/cocoon-file.ts` — types + structural `extractEdges`. Shared.
- `src/lib/definition.ts` — `loadCocoonFile` / `serializeCocoonFile` (editor).
- `src/lib/protocol.ts` — the *entire* editor↔core wire protocol (one graph
  push + one node-state stream + `process`/`invalidate`). Shared; core
  imports it type-only.
- `src/lib/view-contract.ts`, `viewAction.ts` — framework-agnostic View
  contract + the ~20-line Svelte render shim.
- `src/lib/views/{sparkline,inspector,scatterplot}.ts`, `views/index.ts` —
  zero-dep views + the registry imported by **both** sides (core calls
  `serialiseViewData`, browser calls `mount`).
- `src/lib/coreClient.svelte.ts` — reactive WS client; offline fallback.
- `src/lib/CocoonNode.svelte`, `src/App.svelte` — Svelte Flow editor:
  per-node status colour, per-edge item counts, connect/launch panel.
- `core/` — the standalone Node core (run via `node core/cli.ts`, no build):
  `contract.ts` (node-author API), `cast-function.ts`, `nodes/{ReadJSON,
  Map,Filter}.ts`+`index.ts` (the registry), `runtime.ts` (engine: planning,
  memoised re-runs, disk persist, staleness, view serialisation),
  `serve.ts` (WS), `run.ts` (headless stdout), `cli.ts`.
- `src/lib/__tests__/backcompat.test.ts` — vitest over all 7 real examples.

`packages/` (legacy reference, do not build): yarn4/lerna monorepo —
`@cocoon/{types,util,cocoon,editor,monaco,testing,rollup,docs}` and
`@cocoon/plugin-*`. `examples/` holds the canonical fixtures
(`simple-api`, `brushing-and-linking`, `custom-nodes`, `interop`, `testing`,
`imdb`, `noise`).

## Commands

Run from **`prototype/`** (its own `package.json` pins `pnpm@11.1.0`):

- `pnpm dev` (editor) · `pnpm check` (svelte-check) · `pnpm test` (vitest) ·
  `pnpm build`
- `pnpm serve` — start the core for `simple-api` on `ws://localhost:4000`
  (then `pnpm dev` in another terminal; click a node to process it).
- `pnpm core serve <file> [--port N]` / `pnpm core run <file> --target
  cocoon://N/out/p [--format json|table]` — core for any file / headless.

## Guardrails / gotchas

- **pnpm only, from `prototype/`.** The repo-root `package.json` pins
  `packageManager: yarn@4`, so pnpm *refuses* anywhere under the repo except
  inside `prototype/` (which has its own `packageManager`). This is why pnpm
  appeared "not installed" earlier — it was refusing, not missing.
- Don't touch the legacy `packages/` or attempt to build it; it's reference.
- The grammar regexes in `cocoon-uri.ts` are compatibility-critical and copied
  verbatim from legacy — changing them breaks existing files.
- **Ports are edge-derived.** The YAML never declares ports; legacy learns
  `in`/`out` schemas from the node-type JS (not yet loaded). Until then a node
  shows only ports an edge references; non-edge `in:` values are params, not
  ports. Node handle ids therefore must be the port names (not hardcoded), or
  Svelte Flow silently drops the edge.
- Environment: Node 25 here. Legacy is Volta-pinned to Node 16.20.2 (ignore).
- **Node-native TS = explicit `.ts` import extensions.** The core runs via
  `node core/cli.ts` (type-stripping, no build step), and Node refuses
  extensionless relative imports. So core files and any shared module the
  core's import graph touches (e.g. `cocoon-file.ts` → `./cocoon-uri.ts`)
  use `.ts` specifiers; `tsconfig` has `allowImportingTsExtensions` +
  `noEmit` so Vite/Vitest/svelte-check stay happy. `import type` is erased
  by Node, so type-only imports may stay extensionless. View modules must
  keep DOM inside `mount()` (no top-level DOM) so the core can import them.
- **Persist cache** is written `_cocoon_cache/<node>.json` next to the
  cocoon.yml (legacy-faithful; travels with the project, enables offline).
  Gitignored (`_cocoon_cache/`) so it never dirties the canonical fixtures.
- **Deferred (out of scope until raised):** multi-view brushing & linking
  across connected nodes; auto-layout / helper-line snapping; npm plugin
  resolution; single-file-HTML editor bundle + `web+cocoon://` deep-link;
  richer AI surface (CLI+stdout is in — WS-protocol/MCP wrappers later);
  Scatterplot preview sampling for very large datasets.
