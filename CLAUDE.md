# Cocoon

**Agent-first, flow-based data processing.** A collaborative data-mining environment where the agent builds the graph and the human steers and monitors — and the same flow carries you from raw data to insights to running workflow automation, in one tool.

Upstream: https://github.com/aengl/cocoon · npm `@cocoon/cocoon`. A clean Svelte rebuild — feature-complete, pre-1.0. This file is the *concept and architecture* record.

## What you see

A browser canvas shows the **flow** as a graph of nodes coloured by status. The canvas is read-only — edges are not drawn by hand. To change the flow, either:

- **the human** opens `cocoon.yml` in their own text editor and edits YAML alongside the canvas; the core watches the file and reloads with minimal disturbance, or
- **the agent** writes the same file via raw `Edit`/`Write`, and/or announces **suggestions** (presence-announced change-sets the human applies with one click).

Each node carries a hover toolbar (run-to-here, persist, trash, …) and may carry a **control** — a code-declared affordance attached to the node (a steering knob, a chart, a form, an annotation UI). A control renders on two **surfaces**: inline on the node itself (`surface: 'node'` — compact) and in a detached **window** (`surface: 'window'` — roomy); the node's render function may branch on `ctx.surface` to tailor each. The agent may also drop **callouts** — chat-friendly speech bubbles pointing at a node, stepped through by ◀ N ▶ in the header.

## Vocabulary

- **Flow** — a dataflow graph persisted as a single `cocoon.yml`.
- **Node** — one data-processing operation. One co-located source file: `process` (Node-side transform) + optional `control.{data,render,event}` (Node-side) + optional `hook` (browser-side renderer). Plain JS/TS, no build step.
- **Port** — a node's input/output channel. An `in:` key whose value is a `cocoon://` URI is an **edge** (port-to-port wiring); a purely literal `in:` value is **config** (no handle, shown as a title slice).
- **Edge** — `cocoon://<id>/out/<port>` reference, the only edge form.
- **Control** — first-class node concept, peer to ports. Two tiers:
  - **steering** — typed, code-declared knobs (toggle/select/text/number) rendered inline; pure pull (set → `stale` → re-pull, zero side-effects); state is an ephemeral core-held overlay, never YAML.
  - **free-form** — server-built HTML, optionally with an author-written browser hook (the Phoenix-LiveView model including its `phx-hook` escape hatch). Split: `control.data` (core-side, async, bounded) → `control.render` (HTML/+hook, per `ctx.surface` = `'node'` inline or `'window'` detached) → `control.event` (durable write + `markStale`; a selection is just an event). **No rerun**: the control stays live by re-deriving `data()`. No schema — the node *is* the control.
- **Visualisation** — a control with a render hook and no `event`; a selectable one adds `event`. Controls *are* the view layer; the legacy `view:` subsystem is gone.
- **Hook** — the browser half of a node: an imperative `mount/update/destroy` renderer exported from the same source file (the Node-side `process`/`control` is tree-shaken out of the browser bundle).

## Architecture split

A standalone, transport-agnostic Node **core** (`core/`) owns the runtime, the resolver, processing and all port data. The browser **editor** is a pure viewer (no save path, no edge-connect, no YAML pane) that loads the file itself and receives only a stream of per-node state over one WebSocket — never bulk data. The same core is driven headless by a CLI, and by the agent's read/act surface. Remote-core works for free (it's just a WebSocket).

The **agent is a peer client** alongside the editor — never a privileged observer. Reads and acts via the CLI; collaborates with the human via an orthogonal **presence** channel (suggestions, callouts) that processing never reads or gates on.

## Strategy — we own both ends

`~/tibi-old` is the **sole consumer** of Cocoon, and we control that repo too. So "backwards compatibility" is **not** about preserving legacy behaviour, the legacy node-author contract, or the legacy toolchain. The operating model is **co-evolution, not preservation**: both repos move together, and when changing `~/tibi-old` is cleaner than contorting the core, we change `~/tibi-old`.

**Core ships zero nodes, zero vocab.** The platform is the runtime, the resolver, the transport, persistence/agent surfaces, and the type contract — nothing more. Every node a flow uses lives next to the flow (in a sibling `nodes/` dir) or in a declared `nodeDirs:` repo. tibi's `~/tibi-old/packages/cocoon-next/nodes/` is the canonical real-world example — both tibi-domain nodes and the former built-ins live there.

## Execution model

*Pull, not push.* Nothing recomputes behind your back: you **run to** a node and the core processes it plus its transitive upstream in topological order, memoising completed upstream nodes. Memoisation never applies to the explicitly-pulled target — "run to here" always re-runs the target (persist cache fast path applies; persist *is* "serve cached").

Six streamed statuses — `idle · queued · running · done · stale · error` — the only thing the editor colours by.

- **`stale`** = inputs changed, result deliberately kept (amber, "click to re-run"). When a node re-runs, everything reachable downstream is aged. A stale node's persist cache file is dropped (otherwise an outdated cache silently restores).
- **Errors block downstream.** `runOne` never rethrows; `process()` blocks any node whose edge inputs failed/produced nothing — surfaced as `error` "Blocked — upstream X failed". Independent branches still run. Headless `cocoon run` exits non-zero only if the requested target itself failed.
- **Three result-clearing semantics:** *persist toggle off* deletes the on-disk cache only (live result + `done` stay); *trash* (`invalidate`) drops output + cache → `idle`; *stale* is the automatic one above.
- **Persist is a runtime override, never YAML.** In-memory `persistOverride`, streamed as the effective value, resets on restart.

## Architectural keystones

1. **One render contract — the control render hook.** A node is one co-located source file: `process` + `control.{data,render,event}` (Node side) and `export const hook` (browser side, an imperative `mount/update/destroy` renderer depending on nothing). The core esbuild-bundles only the `hook` export and serves it over HTTP (`GET /hook/<type>?m=<mtimeMs>`); the editor dynamic-`import()`s it by convention from the node type — **no registry**. LiveView is the guiding light including its `phx-hook` escape hatch.

2. **The editor is a viewer, not a writer.** The two effective writers of `cocoon.yml` are the human (in their own text editor) and the AI (via raw `Edit`/`Write` against the file text). Both edit YAML as YAML; neither goes through a structural model. The "lossless contract" is *inherited from the absence of a writer*, not maintained by one. No in-app text editor, no save button, no YAML pane, no edge-connect.

3. **Controls are a first-class node concept.**
   - **State is a runtime overlay, never YAML.** Streamed as the effective value, resets on restart.
   - **Durability is ordinary node I/O, not control state.** The side-file is the node's own data plane; `process()` folds it back in. Ephemeral control + durable node I/O, cleanly separated.
   - **Schema is code-declared** — the one narrow registry-free exception. Steering modes/default/form-shape live in node code; free-form has no schema (the node's source is the contract).
   - **The action tier is free-form streamed HTML.** Core-side `control.data(ctx)` → `control.render` → HTML (optionally with author JS hooks per keystone 1) per `ctx.surface` → `control.event` writes the node's own durable file + `ctx.markStale()`. A generic browser shim injects HTML and posts events back via fire-and-forget `controlEvent`. Detached surface = `ControlWindow.svelte`.
   - **No rerun; derive, don't cache.** A control event NEVER re-runs `process()` / the graph. The core re-derives `control.data()` after every event (presentation, not graph execution); the node stays `stale`, the user pulls to fold downstream.
   - **The tier cut is steering vs action, not handler-presence.** Universal/runtime knobs (persist, run, trash) route to the toolbar by definition — never the control pane.

4. **The code is the flow; `cocoon.yml` is the wiring manifest.** "Declarative dataflow in YAML, no-code" was a pre-AI constraint. **Core ships no generics at all** — every node is bespoke, in the project or in a project-shared `nodes/` dir.
   - **No central vocabulary.** Helpers and pure transforms live next to the nodes that use them, not in core.
   - **Config-shaped `in:` is wiring, not a port.** An `in:` key is a connectable port **iff its value is a `cocoon://` edge**; a purely literal value is config (kept verbatim, shown as a title slice, no handle). The grammar's edge-vs-literal split is the sole discriminator; registry-free holds.
   - **Resolution is registry-free, pull-triggered, mtime-keyed.** `type: X` resolves by convention to a file `X.{ts,js,…}` across two roots in no privileged order: (1) `nodes/` next to the cocoon file, (2) dirs declared in `nodeDirs:` (leading `~/` expands to `$HOME/`). Type-name collisions are a categorical hard error, never shadowing. The module is re-imported only if its file mtime changed (`?m=<mtime>` busts the URL-keyed ESM cache) — where `<mtime>` is the max over the entry **and its transitive relative-import (sibling-lib) closure**, and the http-import loader propagates that same token down the static-import graph, so editing a `./lib` the node imports hot-reloads too, not just the entry file. Per-module isolation is automatic + lazy: a broken module fails only its own node, only when pulled. No `serve` restart for node-code edits.
   - **Only affordable because of AI; pays AI back.** AI makes bespoke nodes cheap. In return, bespoke nodes + AI-read/write controls give the agent a typed per-node *act* surface.

5. **Client presence is an optional, orthogonal collaboration side-channel.** Each client (editor tab, headless agent) MAY announce an opaque blob of ephemeral UI state; `presence.ts` (wired in `serve.ts`, **never `Runtime`**) collects per-connection, rebroadcasts, drops on disconnect. **Nothing in processing / the pull graph / persistence depends on it.** The AI is *a peer client*, not a privileged observer.
   - **The suggestion model** (human↔AI write path): the agent reads the human's *unsaved* control text from presence and announces a change-set as its own presence. The editor surfaces it as a generic toast; Apply injects each `{node,field,value}` by the form-field `name` convention. The verdict rides back in the editor's own presence — no new message types, the core stays a dumb relay. Durability stays the human's own Save.
   - **Substrate for brushing & linking** when taken: a selection is one more field a client announces.
   - **Callouts** are informational pointers (not a CTA — the human's reply belongs in chat). The editor snapshots them into its own local state on first observation, so the marker survives the agent's disconnect. The presence layer still evaporates on disconnect; the snapshot lives in editor state, not server-side memory.

## Layout

Two halves joined by a thin transport:

- **`src/lib/`** — the browser editor (Svelte) and the shared editor↔core seam: WS protocol, URI grammar, file loader, the framework-agnostic control-render shims.
- **`core/`** — the standalone Node core (`node core/cli.ts`, no build). Owns the node-author contract, the runtime engine, the registry-free resolver, the hook-bundling delivery seam, the HTTP+WS transport, and the headless/agent CLI mouths. Ships zero nodes.
- **`examples/`** — reference flows (`tmdb/`, `bgg/`). Real, runnable, meant to be read and forked.
- **`sandbox/`** — scratch flows that double as smaller reference impls (`rate/` for both control tiers, `csv-poc/` for the symmetric "each node carries its own deps" story, etc.). Several declare `nodeDirs:` pointing at tibi to exercise the moved-out former built-ins.
- **`src/lib/__tests__/fixture-nodes/`** — test-only node carriers. Vehicles, not vocab.

The file count is small — navigate by reading.

## Commands

Run from the repo root (pnpm@11.1.0):

- `pnpm dev` (editor) · `pnpm check` (svelte-check) · `pnpm test` (vitest) · `pnpm build`
- `pnpm core serve <file> [--port N]` / `pnpm core run <file> --target cocoon://N/out/p [--format json|table]` — core for any file / headless.
- `pnpm core query <overview|node|upstream|downstream|peek> [args]` / `pnpm core set-control <id> <key> <value>` (agent *act* surface; a schema-rejected/pre-resolve write is a silent no-op shown as `IGNORED`) / `pnpm core refresh-control <node>` (re-derive a free-form control out of band — re-runs `control.data`, re-streams `controlData`/HTML, no pull/`process`/stale; the agent's "I wrote the node's durable file, refresh the human's live view" lever) / `pnpm core reload`.
- `pnpm core process <node>` — run on a running `serve`; blocks until settled. `pnpm core presence` — read peers' presence. `pnpm core suggest <node> <field> <value> [--json …]` — announce a change-set, block for the human's Apply/Discard. `pnpm core callout <node> "<message>" [--id ID] [--tone info|warn|error] [--from NAME]` — drop a chat-friendly pointer on a node (fire-and-forget; the marker survives because the editor snapshots callouts). `pnpm core callout-clear <id-or-label>`.
- Full agent guide: `.claude/skills/cocoon/SKILL.md`.

## Implementation rules

Technical constraints not already covered by the keystones:

- **The symmetric-import rule** (load-bearing for any node module that exports a `hook`): top-level imports are limited to `import type` and relative `./` paths. Every npm bare specifier, every `node:*` builtin, every CDN URL is `await import(…)` inside `process` / `control.data` / `control.event` / `mount` — never at module top level. Deps are pinned CDN URLs at the call site (the node carries its own everything, nothing in `node_modules`). Render-only controls with no `hook` export may freely use top-level `node:*`.
- **Flow-relative paths go through `ctx.resolvePath`.** The core does not `chdir` to the flow dir. `path.resolve` semantics, leading `~`→`$HOME`, no args ⇒ the flow dir. Lives on both `ProcessContext` and `ControlContext`.
- **The flow file is watched; node *code* is not.** The flow-file watcher lives in `serve.ts` (one-shot `run` has no clients and must not arm it). Node code is hot-swapped at execution time by the mtime-keyed resolver — no watcher, no `serve` restart.
- **The editor *app* is a static bundle; node code and control hooks are not.** `cocoon serve` serves the pre-built `dist/` editor (built by `pnpm build`; `serve.ts` falls back to headless WS-only when `dist/` is absent). So a change to the **editor app** (`src/lib/**` Svelte/TS — canvas, toolbar, control shim) only shows after `pnpm build` (or use `pnpm dev`'s Vite :5173 against the same core for live editor work). This is the one thing that needs a rebuild: a node's `process`/`control` code hot-swaps by mtime, and a control's browser `hook` is bundled on demand and mtime-cache-busted (`GET /hook/<type>?m=<mtime>`, `no-store`) — neither needs a rebuild or a `serve` restart.

## Deferred (out of scope until raised)

- Multi-control brushing & linking — substrate built (presence + detached windows); the first `selectedRanges` brush prototype was deliberately removed; build the ephemeral live-highlight on presence (a selection is just a `control.event`). The *process-readable filter* half (a brushed selection a downstream node filters on) needs a file-carried selection + a core-owned watcher — design in `docs/brushing-and-linking.md` (control-only refresh already shipped as `cocoon refresh-control`).
- Single-file-HTML editor bundle + `web+cocoon://` deep-link.
- MCP wrapper of the AI surface (a thin shim over `query-client.ts`).
- A control-authoring best-practices guide (likely an extension of the cocoon skill).
- Direct `controlData`/`controlEvent` agent exposure for the autonomous / no-human-in-loop case (the human-present path is done via presence/suggestion).
- Polished example flows (sandboxes are scratch; curated examples in their own dir later).
