# Cocoon

Flow-based workflow automation & data visualisation: a dataflow graph defined
declaratively in YAML, edited visually, with interactive visualisations for
exploring large datasets. Not a replacement for Python/R/Bash/DB scripts —
a way to *unify and document* them. Inspired by KNIME.

Upstream: https://github.com/aengl/cocoon · npm `@cocoon/cocoon`.

## Status: revival

This is a ~10-year-old project (copy of the `2018 cocoon` archive, original
`.git` history intact) being revived. **All active work is in `prototype/`** —
a clean Svelte rebuild. The legacy `packages/` monorepo is kept *only* as a
**porting source and grammar reference** (see Strategy below); it is not
maintained, built, or a contract we owe anyone.

## Strategy — we own both ends

The goalposts moved. `~/tibi-old` is the **sole consumer** of Cocoon, anywhere
— there is no external user to stay compatible with, and we control that repo
too. So "backwards compatibility" is **not** about preserving legacy
behaviour, the legacy node-author contract, or the legacy toolchain for their
own sake. It is narrowed to exactly one operational goal:

> **Run `~/tibi-old/packages/cocoon-next/boardgames.yml` end-to-end on the
> prototype core** — the most important production flow still running legacy
> Cocoon daily. We work against that file a lot.

The approach is **co-evolution, not preservation**: both repos move together,
and when changing `~/tibi-old` is cleaner than contorting the core, we change
`~/tibi-old`. Already done (branch `shed-legacy-cocoon` in that repo): its
legacy `@cocoon/rollup/editor` build was demolished and its custom nodes now
load as **source**. (Historical: they first loaded via a `package.json`
`cocoon.nodes` per-file spec list through `load-nodes.ts`. That was
**replaced** by the keystone-6 convention resolver — tibi's shared nodes
live in a directory declared via the cocoon file's `nodeDirs:` key;
per-module isolation, previously the reason for the per-file list, is now
automatic because resolution is lazy and execution-time. A co-evolution
change in a repo we own; **done and verified — `boardgames.yml` runs
end-to-end on the resolver**.) The package
is
`type: module`; `@cocoon/types` is type-only; cross-file *type* imports use
`import type` (Node's strip-types only erases those); CJS deps (`pg`,
`image-size`, `js-yaml`/`DumpOptions`, `lodash/*` subpaths) use
default-import/`.js` interop; and the small `@cocoon/util` helpers
(`castFunction`, `listDataAttributes`, `castRegularExpression`,
`waitForProcess`) were vendored into `cocoon-next/lib/`. **16/17 nodes
load.** The general nodes its flow needs split two ways (see keystone 6):
**parity-locked** ones whose output is ranking-critical (`Sort`, `Score` —
snapshot-locked, ported bit-for-bit; the "code is the flow" pivot must
**not** touch them) get ported into `prototype/core/nodes/`; **convenience**
ones (`Join`, `Deduplicate`, `Write*`, `Annotate`, `Distance`, `Domain`, …)
are candidates to be **bespoke-replaced under co-evolution** rather than
ported. `Annotate` is the designated first target: its only parity
requirement is "the same annotations land on the same rows by key", which a
bespoke node trivially meets — there is no `orderBy` to replicate, unlike
`Sort`/`Score`. The Tibi-specific ones (`EnqueueInCatirpel`,
`ReadCatirpelData`, `Publish*`, `Slugify`, …) stay in `~/tibi-old`.

**The one holdout — and the gate on true end-to-end `boardgames.yml` —
is `PublishCollections`:** it imports `@cocoon/util/processTemporaryNode`
(run a node type as a temp sub-node mid-`process()`; the deferred
runtime/context extension — see Guardrails) and internally runs `Filter`
and `Score`; `boardgames.yml` also uses a `Score` node directly. `Score`
is **not yet ported** and is output-critical (ranking parity, snapshot-lock
like `Sort`). Both blockers are deliberately left **documented, not built**
(decision, 2026-05-17) — don't stub or half-port them without raising it.

What "faithful" still means, narrowly: (a) the **YAML grammar + lossless
round-trip** (so the real, hand-edited `boardgames.yml` doesn't churn — see
the contract below), and (b) **node-behaviour parity where it changes
production output** (e.g. ranking order — why `Sort`'s lodash `orderBy` was
ported bit-for-bit and snapshot-locked). It does **not** mean preserving the
legacy build, node contract, or infra. The legacy `examples/*` are a
capability roadmap, not a compat surface; `boardgames.yml` is the only
compat surface that matters.

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
- **Control** — a first-class node concept, peer to ports and views: an
  interactive, code-declared knob on a node (a mode toggle, a form, …). A
  hybrid of port (configures processing) and view (interactive,
  framework-agnostic UI). Two tiers by *what it does*, not handler-presence
  (keystone 5): **steering** (pure pull — changes the output, set → `stale`
  → re-pull) and **action** (a side-effect via `invokeControl`). Its *state*
  is an ephemeral core-held runtime overlay (like `persistOverride`),
  streamed as the *effective* value, **never** written to YAML; its *schema*
  is declared in node code (the one deliberate, narrow exception to
  registry-free). Persist's *mechanism* is the prototype, but persist itself
  is **not** a control (universal/runtime-owned knobs are toolbar, not pane).
  Controls retire the legacy "Annotate trick": the feedback loop is now
  contained in one node's boundary, not riding implicit IPC + eager re-run.
- **Brushing & linking** — views on connected nodes synchronise. Lives in the
  WebSocket/IPC layer, *independent of the UI framework* (multi-view sync still
  deferred; the layer it lives in is built, and so is the side-by-side
  substrate — detached `ViewWindow`s, several open at once).
- **Architecture split** — *implemented.* A standalone, transport-agnostic
  Node **core** (`prototype/core/`) owns the registry, processing and **all
  port data**. The browser editor is a pure viewer that loads the file
  losslessly itself and receives only a stream of per-node *state* (status /
  summary / per-port counts / effective persist / serialised view payloads)
  over one WebSocket — never bulk data. The same core is driven headless by a CLI (`cocoon run
  … --target cocoon://N/out/p` → stdout). Forced, not chosen: the browser
  sandbox can't do `fs`/persist and the node library is authored as Node.js
  modules. Remote-core works for free (it's just a WebSocket).

## Execution & node-state model

*Pull, not push.* Nothing recomputes behind your back: you **run to** a node
and the core processes it plus its transitive upstream in topological order,
memoising (`done` with live outputs is skipped). Every node carries one of
six streamed statuses — `idle · queued · running · done · stale · error` —
the only thing the editor colours by.

- **`stale` = inputs changed, result deliberately kept.** When a node
  re-runs, everything reachable downstream — the run-to target's own
  downstream *and* parallel branches off a shared ancestor — is aged via
  `markStale`: in-memory output **and view payload stay visible** (amber,
  "click to re-run"). A pull graph needs a word for "was valid, an input
  moved, not recomputed". Correctness rider: a `stale` node's **persist
  cache file is dropped** (if persisted) — `stale` isn't memoised, so a
  surviving outdated cache would be silently restored instead of recomputed.
  (Legacy had no `stale`; it re-ran eagerly. The revival is pull, so the
  state is *necessary*, not cosmetic.)
- **You can't execute past an error.** `runOne` never rethrows (a throw
  strands every later-planned node in `queued` forever). `process()` instead
  blocks any node whose edge inputs failed/produced nothing — surfaced as
  `error` "Blocked — upstream "X" failed", cascading to its dependents.
  Independent branches still run. Headless `cocoon run` exits non-zero **only
  if the requested target itself** failed — an unrelated dead branch doesn't.
- **Three deliberately-distinct ways a result clears:** *persist toggle off*
  deletes the on-disk cache **only** (live result + `done` stay — persistence
  is disk caching, not the result); *trash* (`invalidate`) is a hard reset
  (drop output + view + cache → `idle`), offered on any node with something
  to discard, not just persisted ones; *`stale`* is the automatic one above.
- **Persist is a runtime/session override, never YAML.** The toggle sends
  `setPersist`; the core holds it in an in-memory `persistOverride` and
  streams the *effective* persist in node-state. It is **not** written back
  to `cocoon.yml` — that would break the lossless contract and there is no
  save path; the processing instance is the source of truth, so the override
  lives there and resets on core restart.
- **Contextual actions are framework-light + extensible.** `CocoonNode`
  renders a hover-revealed floating toolbar (▶ run-to-here, persist toggle,
  🗑 trash, …); each is one pure descriptor in a single `actionList`, so a
  new action is one entry + (if it touches the core) one protocol message.
  The editor↔core seam is a typed Svelte context (`nodeActions.ts`) so custom
  nodes deep inside Svelte Flow reach the core without prop-drilling.

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
3. **The YAML grammar + lossless round-trip is mandatory** (scope: see
   *Strategy* — it is the grammar/round-trip that is a contract, not legacy
   behaviour). The real hand-edited `boardgames.yml` (and `examples/*`) must
   load and round-trip losslessly (see contract below). No in-app text editor
   — the graph editor sits side-by-side with a real text editor, so
   round-trips must not churn hand-edited files. (Flow *content* is fair game:
   we own the producer, so changing a flow can be preferable to contorting the
   core — but never via lossy round-trips.)
4. **The prototype is isolated.** Lives in `prototype/`, pnpm, Vite, fresh
   toolchain — deliberately outside the dead yarn/lerna workspace.
5. **Controls are a first-class node concept (the Annotate trick, done
   right).** Legacy annotation piggy-backed a view's `send`/`receive` +
   `syncViewState` channels onto eager auto-process: the view wrote a
   side-file and `invalidate()`d, an auto-process layer re-ran the node, the
   cycle rode IPC implicitly. The revival deleted both crutches (pull-only;
   `viewState` is read-only from YAML). **Controls** replace the trick with a
   contained, principled mechanism:
   - **State is a runtime overlay, never YAML.** Control state lives in the
     core like `persistOverride`, streams as the *effective* value in
     node-state, and resets on restart. Nothing control-related is ever
     saved — there is no save path and the lossless contract forbids it.
   - **Durability is ordinary node I/O, not control state.** The annotation
     *file* is the node's own data plane: the control is just the trigger;
     the node's normal `process()` folds the file back in (exactly as legacy
     `Annotate.process()` re-read it). Ephemeral control + durable node I/O,
     cleanly separated — this is what makes annotation fit a pull graph.
   - **Schema is code-declared — the one narrow registry-free exception.**
     Ports stay YAML-structure-derived (the lossless contract leans on it); a
     control's modes/default/form-shape live in node code and are streamed to
     the editor like view payloads. The editor thus renders two kinds of
     affordance: structure-derived ports (file-owned, lossless) and
     code-derived controls (core-owned, runtime). **Don't "fix" this by
     putting control defs into `cocoon.yml`** — breaks the contract, no save
     path.
   - **A control invocation is a distinct single-node op, not `process()`.**
     `invokeControl(node, control, payload)` runs the node's control handler
     (may write its output ports + next control state), marks downstream
     `stale`, streams updated node + control state. It is **not** a plan, has
     no upstream pull, is off `runOne` (its own error path). Downstream stays
     `stale` (user re-pulls) — **never** an eager cascade; rebuilding eager
     push "to make annotation feel live" is the exact thing the revival
     deleted.
   - **The tier cut is steering vs action, not handler-presence.** *Steering*
     (simple): changes what's on the output port — pure pull, set → `stale`
     → user re-pulls, zero side-effects by construction. `persist`'s
     *mechanism* generalised — but **persist itself is not a control and
     never enters the control pane**: anything universal + runtime-owned
     (persist, run, trash) routes to the toolbar *by definition*; the pane
     shows only *declared, per-node* knobs, so it is high-signal by
     construction (this is why ubiquity is not noise — ubiquitous ⇒ toolbar,
     not pane). **Build steering first** — *(steering tier **shipped**:
     `ControlSchema` (toggle/select/text/number) in `protocol.ts`;
     `CocoonProcessNode.controls` + `ctx.controls.read()` in `contract.ts`;
     `Runtime.controlOverride`/`setControl`/`controlPatch` — the
     `persistOverride`/`setPersist` twin: schema is lazy, rides node-state
     like a view payload (resolved by keystone-6 `resolver.peek`, never
     eager); a set is a session override that ages the node + downstream
     `stale` with **no upstream pull / no eager cascade**; invalid/unknown/
     pre-resolve writes are silent no-ops; overrides survive `reload` for
     surviving nodes. Inline kind→native-input UI in `CocoonNode.svelte`.
     Proven on clab's `KMeans` (k/metric/normalize) + the four-kind
     `controls.test.ts`. Done & verified.)*. *Action* (rich): performs a
     side-effect (enqueue, write) via a handler + `invokeControl`. But a
     side-effect modelled as a **downstream node the control steers data
     into** stays in the steering tier — the toggle picks the subset, a
     downstream node does the deed on re-pull (side-effect-is-a-node, data
     flow drives it; same principle as selection-as-row-predicate). Render
     inline for steering; an "open control" → detached window (like views)
     for action — **action tier still unbuilt**.
   - **AI read/write is a deliberate contract, not emergent.** Every control
     component must follow a contract that lets the agent **read and write**
     its state over the WebSocket — the typed *act* surface mirroring the
     existing *read* surface (`introspect.ts` / `cocoon query`). This will
     **not** emerge on its own; it is a requirement on every control. Goal:
     "help me translate this German board game description into English"
     succeeds with no extra context — the agent introspects the control
     schema + state and writes it. This is what keystone 6 is *for*.
     *(Read surface **shipped**: `nodeDetail` returns `controls` +
     `controlState`; `query node <id>` exposes both. Act surface
     **shipped**: the `setControl` WS message — peer to `setPersist`, the
     agent's typed write — now also a first-class CLI verb (`cocoon
     set-control <id> <key> <value>`, `sendSetControl`; the previously
     CLI-less gap, closed and verified against the live core). The `text`
     kind exists precisely for the German-translation goal; clab's `KMeans`
     does not contrive a text knob, so `text` is proven by
     `controls.test.ts` rather than over-fitted there.)*
6. **The code is the flow; `cocoon.yml` is the wiring manifest (every
   meaning-node carries its own code).** "Declarative dataflow in YAML,
   no-code" was a pre-AI constraint. With AI authoring nodes, a generic node
   + custom extension is *inheritance* (Template Method: fragile base class,
   extension coupled to the base's lifecycle). The FP correction: **the
   library offers a vocabulary (functional primitives a node calls), not a
   skeleton (a base to extend).** A bespoke node is a plain `process(ctx)`
   composing primitives — no base, no lifecycle beyond the contract.
   - **The bespoke-ness was always there, in the worst place.** A
     `Filter`/`Map` with a predicate *param* is already a one-off node whose
     code is a stringified lambda in YAML (no types, imports, tooling, or
     readable diff). The pivot doesn't introduce per-node code; it relocates
     code that already exists into honest files. **The line:** if a node's
     YAML carries a code-shaped param, it should be a file.
   - **Generics stay; the line is "generics with controls".** Mechanism
     nodes (`ReadCSV`, `Download`, `Pipe`, `Run` — genuinely reusable, no
     domain meaning, no code param) remain generic. **Controls are only
     introduced for custom nodes**, never bolted onto generics. Over time
     generic functionality migrates into a library of functional primitives
     and generic nodes may be phased out entirely — direction, not deadline.
   - **This reframes the lossless contract's *purpose*, not its rules.**
     Losslessness was protecting a behavioural spec; now it protects the
     hand-edited *wiring*. Same mechanism (editor owns only edges +
     `editor.col/row`), honest rationale. `cocoon.yml` is no longer "the
     flow" — it is the flow's wiring; the nodes' code is the flow.
   - **Resolution is the first thing built; it completes "registry-free".**
     Not only is port schema not module-derived — modules aren't
     pre-registered either. There is **no registry map and no
     `package.json`/`cocoon.nodes` lookup**. A node `type: X` resolves by
     convention to a file `X.{ts,js,…}` across three roots, in no privileged
     order: (1) the core-internal node dir (built-ins are just files here —
     the `nodes/index.ts` barrel is deleted), (2) a `nodes/` dir next to the
     cocoon file, (3) extra dirs the cocoon file itself declares (a
     hand-authored top-level key, preserved by the "unknown keys pass
     through" rule, for shared node repos like tibi's — *replacing*
     `cocoon.nodes`). **Type-name collisions across roots are a categorical
     hard error, never shadowing** (generic nodes phase out, so the overlap
     is transient and override semantics aren't worth the edge cases).
     Loading is **pull-triggered, execution-time, mtime-keyed**:
     `resolve(type)` runs when a node runs; the module is re-imported only
     if its file mtime changed (a `?m=<mtime>` specifier — the ESM cache is
     URL-keyed, so the *key*, not re-calling `import()`, is what busts it).
     This **is** keystone-6's hot reload, but **pull-triggered, not
     watcher-triggered** — strictly simpler (no watcher, debounce, or
     watch/edit race) and pull-aligned. Per-module isolation becomes
     automatic + lazy: a broken module fails only its own node, only when
     pulled; unused nodes are never loaded. No `serve` restart for
     node-code edits — only core-runtime code still needs one.
     *(Built: `core/resolve-nodes.ts` (`NodeResolver`); registry map +
     `load-nodes.ts` + `nodes/index.ts` barrel deleted; `runtime.ts`
     resolves at execution time. Verified on the `boardgames.yml`
     production flow. **This gate was cleared and keystone 5's steering
     control tier — which was waiting on it — is now shipped (see
     keystone 5). The live next step is keystone 5's *action* tier
     (`invokeControl` + detached control window), still unbuilt.**)*
   - **Only affordable because of AI; pays AI back.** AI is what makes "every
     meaning-node is bespoke" cheap (it writes the one-off faster than a
     human finds and configures a generic), live, no restart (YAML update +
     module hot-reload). In return, bespoke nodes + AI-read/write controls
     (keystone 5) give the agent a typed per-node *act* surface — the read
     surface becomes read+act. The two reinforce; neither stands alone.

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
  top-level keys — all preserved. The keystone-6 resolver's extra-node-dirs
  key is one such hand-authored, pass-through key (like `env`); the editor
  never writes it.
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
  push + one node-state stream + `process` / `invalidate` / `setPersist` /
  `reload` + one correlated `query`→`queryResult` pair; node-state carries
  effective `persist` and, on `error`, `errorStack` / `inputDigest` /
  `errorAt` diagnostics). Shared; core imports it type-only. The agent ↔
  live-core surface rides this protocol — **detailed agent docs live in
  `.claude/skills/cocoon/SKILL.md`** (an installable Cocoon skill), not here.
- `src/lib/view-contract.ts`, `viewAction.ts` — framework-agnostic View
  contract + the ~20-line Svelte render shim (now also feeds container
  *resize* back in as an `update()` via a rAF-debounced `ResizeObserver`,
  so the SVG views redraw inside a resizable window; CSS transforms don't
  change the layout box so it stays quiet during Svelte Flow pan/zoom).
- `src/lib/views/{sparkline,inspector,scatterplot,image}.ts`, `views/index.ts`
  — zero-dep views + the registry imported by **both** sides (core calls
  `serialiseViewData`, browser calls `mount`). `image` reads a file → base64
  → `data:` URI; it imports **no `node:fs`** (that would poison the browser
  bundle) — the core hands `serialiseViewData` a `ViewSerialiseContext`
  (`readFileBase64`, resolving relative paths against the cocoon dir like the
  I/O nodes). A type-only view string binds to the view's `defaultPort`
  (legacy parity — `Image` → the `src` output port), so bare `view: Image`
  + static `out: { src: … }` works. `scatterplot` self-sizes — fills a
  height-definite host (the detached ViewWindow, redrawn by viewAction's
  ResizeObserver as the window grows) with a `min-height` floor inline.
- `src/lib/coreClient.svelte.ts` — reactive WS client (`process` /
  `invalidate` / `setPersist`); offline fallback.
- `src/lib/nodeActions.ts` — typed editor↔core action context
  (`provideNodeActions` / `useNodeActions`): the node toolbar's seam to the
  core, prop-drill-free through Svelte Flow. Also carries `openView` (toolbar
  → App's window manager).
- `src/lib/CocoonNode.svelte`, `src/App.svelte` — Svelte Flow editor:
  per-node status colour, per-edge item counts, connect/launch panel, the
  hover-revealed floating action toolbar (run / persist / **open-view** /
  trash, extensible), all YAML-declared ports labelled *outside* the box
  (a clipped `.body` wrapper so labels can overflow), and literal `in:`
  params printed under the title as a one-line, ellipsised YAML slice
  (full value in a hover tooltip). Dagre (`@dagrejs/dagre`, LR) re-lays
  the graph for *display* once per loaded file — a pure view-layer pass
  (the loader still owns positions + `autoCol/autoRow`, synced to the
  placed coords so an undragged node still serialises churn-free).
- `src/lib/FitOnLoad.svelte` — logic-only child of `<SvelteFlow>` that
  refits the viewport after each load (the Dagre pass runs post-mount, so
  the `fitView` prop alone fits stale pre-layout positions and big graphs
  land off-screen). Waits two rAFs (laid out *and* measured) then
  `fitView`.
- `src/lib/ViewWindow.svelte` — a detached, draggable/resizable/closable
  window that mounts the *same* `use:viewAction` renderer full-size. Toolbar
  `openView` (a pure editor-side action — the view payload already streams in
  node-state, no protocol message) routes through `nodeActions` to App's
  window manager (`windowIds`: ordered, last = topmost, re-focus/bring-to-
  front, cascade offset). Several open at once is the side-by-side substrate
  brushing & linking will later synchronise over (`onViewState` is the wired-
  but-deferred extension point).
- `core/` — the standalone Node core (run via `node core/cli.ts`, no build):
  `contract.ts` (node-author API), `cast-function.ts`, `nodes/{ReadJSON,
  ReadCSV,Map,Filter,Download,Run,Pipe}.ts`+`index.ts` (the built-in registry;
  `Download`/`Run`/`ReadCSV`/`Pipe` are zero-dep ports of the legacy `got`/
  `lodash`/`csv-parser` nodes — `fetch`+`node:stream`, `node:child_process`,
  a hand-rolled streaming CSV parser — that make `examples/imdb` runnable and
  `examples/interop`'s Python half runnable), `load-nodes.ts`
  (project-local custom nodes: legacy `package.json` `cocoon.nodes`,
  CJS/ESM named exports, merged over the built-ins, non-fatal on failure),
  `runtime.ts` (engine: planning, memoised re-runs, upstream-error
  isolation/blocking, disk persist + runtime persist override,
  stale-as-visible, view serialisation, plus `peek` / `reload` and on-throw
  `errorStack`+`inputDigest`+`errorAt` capture), `introspect.ts`
  (transport-agnostic AI read surface: `digest` / `overview` / `nodeDetail` /
  `relatives` / `peekData` — everything bounded, never bulk port data),
  `query-client.ts` (thin WS client to a *running* core: `sendQuery` /
  `sendReload` / `sendSetControl` — the last is the agent *act* surface; no
  correlated ack, so it anchors on the `node` broadcast whose
  `controlState[key]` matches the sent value, never a positional count
  (a `done` node's `markStale` fires an earlier old-value broadcast), with
  the parallel `query` as the no-op fallback), `serve.ts` (WS; routes
  `query`→`queryResult`, `reload`→rebroadcast), `run.ts` (headless stdout),
  `cli.ts` (`serve`/`run` own a Runtime; `query`/`set-control`/`reload` are
  a mouth for a running one).
- `src/lib/__tests__/backcompat.test.ts` — vitest over the 6 retained examples;
  `custom-nodes.test.ts` — custom-node loading + Runtime error surfacing;
  `imdb-nodes.test.ts` — the imdb graph shape (Download→Run `gzip`→ReadCSV)
  end-to-end through Runtime against a local server + tiny fixtures (the real
  IMDB datasets are multi-GB, so never downloaded in tests);
  `interop-pipe.test.ts` — `Pipe` through Runtime (stdin/stdout +
  serialise/deserialise + the non-zero-exit error path) using a `node`
  subprocess, so the suite needs no python/R;
  `image-view.test.ts` — static `out:` port seeding + the Image view
  (bare `view: Image` → `defaultPort` `src` → file → `data:` URI; missing
  file → `null`) against a 1×1 PNG fixture, also python/R-free;
  `ai-session.test.ts` — the AI loop end-to-end over the `examples/clab`
  fixture (process→error w/ stack+inputDigest→peek+descend+where→reload→done
  + bounded viewData) + `digest`/`peekData` unit bounds;
  `serve-ws.test.ts` — the WS transport (query↔queryResult correlation,
  reload rebroadcast); `cli-query.test.ts` — `query-client` + the shipped
  `cli.ts` binary against a running core; `port-concat.test.ts` — multi-edge
  port concatenation (legacy `getPortData` parity);
  `controls.test.ts` — steering controls (keystone 5): lazy schema, effective
  = override ?? default, `setControl` ages node + downstream with no
  upstream/cascade, invalid/pre-resolve no-ops, override survives `reload`,
  all four kinds, + the `nodeDetail`/`setControl` agent surface on clab
  `KMeans`.

`packages/` (legacy reference, do not build): yarn4/lerna monorepo —
`@cocoon/{types,util,cocoon,editor,monaco,testing,rollup,docs}` and
`@cocoon/plugin-*`. `examples/` holds the canonical fixtures
(`simple-api`, `brushing-and-linking`, `custom-nodes`, `interop`, `imdb`,
`noise`). The legacy examples currently serve as a **capability roadmap**,
not a compat surface — faithful round-trip fixtures get authored later, when
it actually matters; for now they just enumerate what the prototype must be
able to run. **`examples/clab`** is the exception — not a roadmap example but
the AI-debug-loop regression fixture (a custom clustering node over BGG-shaped
`{id, document-as-JSON-string}` rows; see its README), excluded from the
back-compat suite.

**`testing` is deliberately dropped** (kept in `packages/`-era git history,
removed from the roadmap and the back-compat suite). Cocoon is not a test
runner: the legacy example's own README disowned that use ("most certainly a
questionable move"), and its `Puppeteer` node passes a *non-serialisable*
browser context node-to-node — directly violating the keystone that all port
data is serialisable (it's streamed as state and disk-cached). The one good
idea it gestured at — "nodes are just functions, so trivially unit-testable"
— is already an architectural property, demonstrated by `custom-nodes.test.ts`
/ `imdb-nodes.test.ts` calling `.process(ctx)` directly; "headless run +
snapshot a definition" is already what `cocoon run` + back-compat do. Don't
resurrect it.

## Commands

Run from **`prototype/`** (its own `package.json` pins `pnpm@11.1.0`):

- `pnpm dev` (editor) · `pnpm check` (svelte-check) · `pnpm test` (vitest) ·
  `pnpm build`
- `pnpm serve` — start the core for `simple-api` on `ws://localhost:4000`
  (then `pnpm dev` in another terminal; click a node to process it).
- `pnpm core serve <file> [--port N]` / `pnpm core run <file> --target
  cocoon://N/out/p [--format json|table]` — core for any file / headless.
- `pnpm core query [--core ws://localhost:4000] <overview|node|upstream|
  downstream|peek> [args]` / `pnpm core set-control <id> <key> <value>`
  (the agent *act* surface — `<value>` is JSON-parsed; a schema-rejected /
  pre-resolve write is a silent no-op shown as `IGNORED`) / `pnpm core
  reload` — agent client to a *running* `serve` (not a fresh Runtime). Full
  agent guide: `.claude/skills/cocoon/SKILL.md`.

## Guardrails / gotchas

- **pnpm only, from `prototype/`.** The repo-root `package.json` pins
  `packageManager: yarn@4`, so pnpm *refuses* anywhere under the repo except
  inside `prototype/` (which has its own `packageManager`). This is why pnpm
  appeared "not installed" earlier — it was refusing, not missing.
- Don't touch the legacy `packages/` or attempt to build it; it's reference.
- The grammar regexes in `cocoon-uri.ts` are compatibility-critical and copied
  verbatim from legacy — changing them breaks existing files.
- **Ports are YAML-structure-derived, not schema-derived.** Legacy learns
  `in`/`out` schemas from the node-type JS; the prototype must not. Custom
  node modules *are* now loaded (`load-nodes.ts`), but the core stays
  registry-free *by contract*: `CocoonProcessNode` deliberately omits
  `in`/`out`, so a loaded module's port schema is ignored. What a node shows
  is read from the YAML *structure* only: every `in:` key is an input port
  (edge **or** literal param) and every `out:` key a statically-seeded
  output port, plus output ports surfaced by an edge (a producer rarely
  declares `out:`) — all in file order, registry-free. Literal `in:` values
  are *still* params (preserved verbatim on round-trip, the editor owns only
  edges + `editor.col/row`) but are now *also* surfaced as input ports and
  printed under the title as a faithful YAML slice. Node handle ids must be
  the port names (not hardcoded), or Svelte Flow silently drops the edge.
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
  Disabling persist (and trash) deletes the file; `markStale` deletes it too.
- **Persist toggling is a runtime override — never write it to YAML.** It
  lives in the core's in-memory `persistOverride` and resets on restart.
  "Fixing" it to emit `persist:` into `cocoon.yml` breaks the lossless
  contract (editor owns only edges + `editor.col/row`) and there is no save
  path — don't.
- **Controls: the don't-list (full rationale in keystone 5; steering tier
  **shipped** — `Runtime.setControl`/`controlOverride`/`controlPatch`,
  `controls.test.ts`; the action tier is still unbuilt).** Control state
  is a runtime overlay — **never** write it to `cocoon.yml` (no save path;
  breaks the lossless contract, exactly like persist). Control *schema* is
  code-declared and streamed — **don't** derive it from YAML structure (the
  one narrow, deliberate registry-free exception; ports stay
  structure-derived). The tier cut is **steering vs action**, not
  handler-presence — **don't** put a universal/runtime-owned knob (persist,
  run, trash) in the control pane; those are toolbar by definition, the pane
  is declared per-node knobs only. A steering control is pure pull (set →
  `stale` → re-pull); an action control's `invokeControl` is a single-node
  op off `runOne`/the plan — **don't** make it pull upstream, rethrow, or
  eager-cascade downstream. A side-effect is better a downstream node than
  baked into the control. Durable annotation data is the node's own I/O —
  **don't** stuff it into control state. Every control must expose state for
  agent read+write over the WS — **not** optional, **not** emergent.
- **`runOne` must never rethrow.** A throw aborts the whole plan loop and
  strands later-planned nodes in `queued` forever (the original bug). Record
  the failure as `error` and return; `process()` blocks dependents and is the
  sole owner of the headless non-zero exit (keyed off the *target* only).
- **Deferred — node errors carry no stack/trace.** `runOne` records only
  `err.message` into node-state `error` (and `serve.ts` logs `err.message`);
  the original stack is dropped, so a failure like `Invalid string length`
  gives no hint *where* it threw. Known diagnostics gap, intentionally unbuilt
  for now — when raised, surface the stack (core log and/or a `NodeState`
  field). Don't treat the one-line message as sufficient for debugging.
- **Out-of-band node crashes are the node's, not the core's.** A node doing
  async I/O can throw with nothing awaiting it (the real case: `pg` throwing
  "client password must be a string" from a TLS socket handler) — an
  `uncaughtException`/`unhandledRejection` that bypasses `runOne`'s catch.
  `core/node-guard.ts` reroutes it onto the running node (one process-lifetime
  listener; attribution is unambiguous because the plan loop is strictly
  sequential) so it becomes that node's `error` via the same catch; a
  straggler with no active node is logged, never fatal. `cli.ts` owns the
  headless exit explicitly (catches `run()` → `exitCode=1`) so the guard
  doesn't swallow the deliberate target-failure rejection. Don't make the
  guard per-node (listener races) or let it swallow when a node *is* active.
- **`markStale` must drop a persisted node's cache file.** `stale` isn't
  memoised; a surviving outdated cache would be restored instead of
  recomputed — now doubly so, since restore happens at **load**
  (`hydratePersisted`) as well as in `runOne` — a silent stale-data bug. Conversely it *keeps* in-memory output + `viewData` so the
  last result stays visible — don't "tidy" that into a full reset (that's
  trash's job, a different intent).
- **Persist-cache writes must stream, never `JSON.stringify` the whole
  output.** `boardgames.yml`'s `ImportBGGData` (`SELECT id, document FROM
  boardgamegeek`, 153k rows / ~542 MiB JSON) overflowed V8's
  536,870,888-char string cap → the node died `RangeError: Invalid string
  length`. `core/persist-cache.ts` (`writePersistedCache`, used by both the
  `runOne` and `setPersist` write paths) emits the cache item-by-item — bytes
  **identical** to `JSON.stringify(ports)`. Legacy-faithful: a port of
  `@cocoon/cocoon`'s streamed `writePersistedCache`, which streamed for this
  exact reason. Don't "simplify" it back to
  `fs.writeFile(p, JSON.stringify(written))`. **Read side is now streamed
  too** (`readPersistedCache`): a chunked, compacting recursive-descent JSON
  parser — never one `readFile`-as-string, never one whole-blob `JSON.parse`,
  so the >512 MiB cache is actually *restored*. The old
  `JSON.parse(readFile(..,'utf8'))` threw `Invalid string length` and a bare
  `catch {}` silently recomputed — that is how this regression hid; the catch
  now logs (ENOENT = expected; anything else = loud "present but
  unrestorable"). Don't reintroduce `readFile`-as-one-string or a silent
  catch. Restore is **not lazy**: `hydratePersisted()` runs it for every
  persisted node at load/reload (legacy parity — see the `reload` bullet).
- **Multi-edge ports concatenate — verbatim legacy `getPortData`.**
  `in: { data: [cocoon://A/out/x, cocoon://B/out/y] }` feeds the node
  `A.x ⧺ B.y`: `resolveInputs` drops `undefined` producers, then
  `present.length <= 1 ? present[0] : present.flat()` —
  `Array.flat()` (depth 1) **is** lodash `_.flatten` (lone producer/non-array
  values pass through; arrays concatenate). Nodes therefore receive a **flat
  list** and must never re-flatten themselves (legacy `Annotate` is a bare
  `data.map`; the boardgames `Annotate ← SortByRank/out/{data,unsortable}`
  failure that surfaced this was fixed *here*, not in the node — a per-node
  patch was reverted as a symptom fix). Don't "simplify" this back to nesting
  the values — it silently corrupts every multi-edge node's input.
- **`reload` re-reads the flow; node *code* is hot-swapped by the resolver
  (keystone 6).** `reload` re-parses the YAML, re-extracts edges,
  full-resets state (store cleared → all `idle`, then `hydratePersisted()`
  brings persisted nodes back `done` from disk cache immediately — not "next
  process"), and rebroadcasts so the editor repaints. Node *code* is **not**
  reloaded by `reload` and does **not** need a `serve` restart: the
  convention resolver re-imports a node's module at execution time when its
  file mtime changed (`?m=<mtime>` specifier — the ESM cache is URL-keyed,
  so the key busts it; re-calling `import()` alone does not). Pull-triggered,
  not a watcher — picked up on the next pull, exactly when it matters. The
  *only* thing still needing a `serve` restart is **core-runtime** code
  (runtime.ts/resolver/protocol), since those are imported once at startup,
  not per node-run. Don't reintroduce a registry map, a filesystem watcher,
  or a process-wide cache bust; don't make a code change auto-run (mark
  `stale`, the user re-pulls).
- **The resolver's first import must stay query-free — vitest trap.**
  `resolve-nodes.ts` `loadModule` appends `?m=<mtime>` **only on a
  re-import** of an already-loaded module (hot reload); the *first* import
  of a file is a plain specifier. This is load-bearing, not an optimisation:
  vitest's esbuild transform fails on a `file://…ts?m=` URL (`Transform
  failed`), so an always-query form silently breaks the **entire** test
  suite (it did — 20 failures, all "Unknown/blocked" because every built-in
  failed to load). Plain Node handles the query fine; it's only needed to
  bust the URL-keyed ESM cache for a genuine re-import. Don't "simplify"
  `loadModule` to always carry the query.
- **Deferred (out of scope until raised):** multi-view brushing & linking
  across connected nodes. The detached-window substrate is built
  (`ViewWindow.svelte`, several open side-by-side; `onViewState` is the
  wired-but-no-op seam). A first `selectedRanges`-brush prototype was built
  and **deliberately removed** — `rectangle→range` is a leaky abstraction;
  **don't re-add the range form.** The conceptual successor is **Controls**
  (keystones 5–6) for the steering half and `selection-as-row-predicate`
  (*Design ideas*) for the transient/highlight half — port-attached
  predicates were **folded into Controls**, no longer a separate idea.
  Helper-line snapping (Dagre LR auto-layout is **done** — see the
  `App.svelte`/`FitOnLoad.svelte` Layout entries); npm-*package*
  plugin resolution (project-local `package.json` `cocoon.nodes` now loads
  via `load-nodes.ts` — bare npm-package specs resolved from `node_modules`
  are the still-deferred part); single-file-HTML editor bundle +
  `web+cocoon://` deep-link;
  an **MCP** wrapper of the AI surface (the WS `query`/`reload` protocol +
  `introspect.ts` + the `cocoon query` client are **shipped** — MCP is a thin
  shim over `query-client.ts`, still deferred);
  Scatterplot preview sampling for very large datasets;
  **`processTemporaryNode`** (a node running another node type as a temp
  sub-node mid-`process()`; needs a `ProcessContext` + runtime extension);
  the **`Gallery`** view. *(Done, no longer deferred: the `Image` view +
  static/file-backed `out:` port seeding — `runtime.seedStaticOut`, legacy
  `writeToPorts(node, definition.out)` parity; Dagre LR auto-layout +
  load-time viewport refit; the **AI ↔ live-core surface** — WS
  `query`/`reload` + `queryResult`, `introspect.ts`, on-throw
  stack/inputDigest/errorAt, the `cocoon query`/`reload` client, and the
  `.claude/skills/cocoon` skill.)*
- **Example status / known "no"s** (the legacy examples are a capability
  roadmap, not yet a compat surface): `simple-api`/`noise`/`imdb` run;
  **`interop` fully runs** — `GenerateInPython`→Scatterplot *and*
  `VisualiseInR` (`Pipe`→R; `out: {src: plot.png}` seeded → `Image` view →
  `data:` URI). Needs python3 + R on the machine (R installed here via
  `brew install r` + `jsonlite`/`ggplot2`); that's an environment dep, not a
  project concern. `custom-nodes`:
  `ExampleNode` was **de-lodash'd to zero-dep** (the example installs with
  *nothing*; the npm-dep custom-node loader path was verified once with
  lodash installed, then tossed), `DownloadImages`/`MapData` run; **`Wikipedia`
  is deferred** — it calls `processTemporaryNode('Distance', …)`, i.e. the
  deferred temp-node feature *and* the deferred `@cocoon/plugin-distance`
  npm-plugin, so it stays a non-fatal load failure by design. `custom-nodes`'
  only `Gallery` node is `Wikipedia`, so Gallery waits for
  `brushing-and-linking` (`FishGallery`) to actually exercise it. Don't
  resurrect any of these without raising it first.

## Design ideas (unresolved — not yet decided)

A parking lot for concepts being weighed. **Distinct from "Key decisions"
(settled keystones) and "Deferred" (known scope, just unbuilt): these change
the model and are not agreed yet.** Don't implement from here without raising
it; do append to it.

- **Port-attached filter predicates — RESOLVED, superseded by Controls
  (keystones 5–6).** This proposed making a *port* the interaction surface
  with an attached predicate. Killed for two reasons, recorded so it isn't
  re-proposed: (1) **wrong unit** — a single semantic op ("top-rated only")
  is *node-level intent that fans out to multiple ports*; a per-port
  predicate is the wrong granularity. (2) Its hardest open question ("can't
  live in lossless `cocoon.yml`") was a *symptom of the no-code assumption*;
  once meaning-nodes carry their own code (keystone 6) the requirement
  evaporates — the node's code is the documentation, in a better medium. A
  control achieves the same trivial-node-tax collapse, node-scoped, explicit,
  interactive, and AI-steerable. **Don't reintroduce the per-port predicate
  form.**

- **Selection = a row predicate the view emits as ordinary data.** The
  conceptual successor to the removed `selectedRanges` brush, and the
  *transient/interactive* face of the port-predicate idea. The only thing
  every selection has in common is not geometry (a scatterplot rectangle, a
  violin band, a bar, a map lasso, a table multi-select are all different) —
  it's "*which records*". So a view's only selection job is geometry → row
  membership; it emits ids/a mask. Then **linking needs no node** (the set
  rides the existing WS layer to other open views, which re-style — legacy's
  "Highlight Sync" was explicitly "not a node, just data flow") and **acting
  on it needs no special node** (materialise it as a column / `ids` and the
  generic `Filter` consumes it — never a bespoke `FilterRanges`). Filter
  = the materialised/durable form, mask/highlight = the transient form;
  same primitive, two intensities. Cross-ref: a view emitting a selection is
  a *control-shaped return channel* — when built it should ride the
  keystone-5 control read/write contract, not a new view-shaped one. Still
  unresolved: the filter-vs-mask intensity fork.
