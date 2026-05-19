# Cocoon

Flow-based workflow automation & data visualisation: a dataflow graph defined
declaratively in YAML, edited visually, with interactive visualisations for
exploring large datasets. Not a replacement for Python/R/Bash/DB scripts —
a way to *unify and document* them. Inspired by KNIME.

Upstream: https://github.com/aengl/cocoon · npm `@cocoon/cocoon`.

A ~10-year-old project being revived. **All active work is in `prototype/`** —
a clean Svelte rebuild (own pnpm/Vite toolchain, deliberately outside the dead
yarn/lerna workspace). The legacy `packages/` monorepo is kept *only* as a
porting source and grammar reference: not maintained, not built, not a contract
we owe anyone.

## Strategy — we own both ends

`~/tibi-old` is the **sole consumer** of Cocoon anywhere, and we control that
repo too. So "backwards compatibility" is **not** about preserving legacy
behaviour, the legacy node-author contract, or the legacy toolchain. The
operating model is **co-evolution, not preservation**: both repos move
together, and when changing `~/tibi-old` is cleaner than contorting the core,
we change `~/tibi-old`. The anchoring goal — run
`~/tibi-old/packages/cocoon-next/boardgames.yml` end-to-end on the prototype
core — is met; co-evolution stays the model for further work against that file.

tibi's custom nodes load as **source** (no legacy rollup/editor build),
resolved by the keystone-6 convention resolver from a directory declared via
the cocoon file's `nodeDirs:` key. The package is `type: module`;
`@cocoon/types` is type-only; cross-file *type* imports use `import type`; CJS
deps (`pg`, `image-size`, `js-yaml`, `lodash/*` subpaths) use
default-import/`.js` interop; small `@cocoon/util` helpers are vendored into
`cocoon-next/lib/`.

Node split (three buckets):
- **Parity-locked** — output is ranking-critical. Ported bit-for-bit and
  snapshot-locked into `prototype/core/nodes/` (e.g. `Sort`'s lodash
  `orderBy`). The "code is the flow" pivot must **not** touch these.
- **Convenience** (`Join`, `Deduplicate`, `Write*`, `Annotate`, `Distance`,
  `Domain`, …) — bespoke-replaced under co-evolution rather than ported.
- **Tibi-specific** (`EnqueueInCatirpel`, `ReadCatirpelData`, `Publish*`,
  `Slugify`, `Score`, …) — stay in `~/tibi-old`. **`Score` +
  `@cocoon/plugin-distance` are Tibi-domain** (driven by tibi's per-collection
  `score:` configs), live in `~/tibi-old/packages/cocoon-next/` (`nodes/`
  + `metrics/*` + vendored lodash/cast-function slices) and are parity/snapshot
  -locked there via `node --test`. They are **not in core** — the keystone-6
  resolver makes a type-name collision across roots a hard error.

What "faithful" narrowly means: (a) the **YAML grammar + lossless round-trip**
(so the hand-edited `boardgames.yml` doesn't churn — see the contract), and
(b) **node-behaviour parity where it changes production output** (ranking
order — why `Sort` is snapshot-locked). It does **not** mean preserving the
legacy build, node contract, or infra. `boardgames.yml` is the only compat
surface that matters; the legacy `examples/*` are a capability roadmap, not a
compat surface.

## Core concepts

- **Node** — one data-processing operation; the unit of work. The node library
  is plain **JS** (or `.ts`, types stripped by Node at runtime — no build
  step). The YAML layer stays **registry-free**: it never depends on node-type
  port schemas, only on YAML structure.
- **Graph** — nodes wired into a dataflow, persisted as YAML (the "Cocoon
  definition file"). The editor is a view/controller; the processing instance
  is the source of truth.
- **Visualisation** — *not a separate concept.* A visualisation is just a
  **control with a render hook and no `event`**; a selectable one adds
  `event`. There is no View layer, no `view:`-driven subsystem, no "port it
  to a View". The four legacy built-in views are ordinary nodes in
  `core/nodes/` (`Scatterplot`/`Inspector`/`Sparkline`/`Image`).
- **Control** — a first-class node concept, peer to ports: an
  interactive (or purely visual) affordance on a node. Two tiers by *what it
  does* (keystone 5), both built:
  - **steering** — typed, code-declared knobs (toggle/select/text/number)
    rendered inline; pure pull (set → `stale` → re-pull, zero side-effects);
    state is an ephemeral core-held overlay (the `persistOverride` twin),
    streamed as the effective value, never YAML.
  - **free-form** — the single node-attached render surface (it is also how
    visualisations are built). The node renders server-built **HTML,
    optionally with author JS hooks** — the full Phoenix-LiveView model
    *including its `phx-hook` escape hatch*. A generic browser shim posts
    `data-cocoon-event`s back; the node interprets them, writes its **own
    durable I/O**, `markStale()`s. No schema (the node *is* the control). The
    data+render+event split: `control.data` (core-side, async, bounded) →
    `control.render` (HTML/+hook, per `ctx.surface` = inline vs detached) →
    `control.event` (durable write + `markStale`; **a selection is just an
    event**, no special node — a visualisation simply omits `event`). **No
    rerun**: the control stays live by re-deriving `data()` (presentation,
    not graph execution). **Exactly one disciplined mechanism** delivers
    author render code + its deps to the browser — *not* ad-hoc `<script>`
    per control, *not* Node-module code (no `fs`/`pg` client-side); that hook
    delivery path also subsumes bare-npm-package resolution (pinned CDN URLs
    inlined at bundle time).
  The legacy "Annotate trick" done right: the feedback loop is contained in
  one node's boundary, the durable side-file is the node's own data plane
  folded back in by its normal `process()` on re-pull — never implicit IPC +
  eager re-run.
- **Brushing & linking** — controls on connected nodes synchronise; lives in
  the WS layer, independent of the UI framework. Multi-control sync deferred,
  but the substrate exists: the client-presence channel (keystone 7) +
  detached `ControlWindow`s. When taken, build it **there** (a selection is a
  field a client announces), not a bespoke channel.
- **Architecture split** — a standalone, transport-agnostic Node **core**
  (`prototype/core/`) owns the registry, processing and **all port data**.
  The browser editor is a pure viewer that loads the file losslessly itself
  and receives only a stream of per-node *state* (status / summary / per-port
  counts / effective persist / bounded control payloads) over one WebSocket —
  never bulk data. The same core is driven headless by a CLI (`cocoon run …
  --target cocoon://N/out/p` → stdout). Forced, not chosen: the browser
  sandbox can't do `fs`/persist and the node library is Node.js modules.
  Remote-core works for free (it's just a WebSocket).

## Execution & node-state model

*Pull, not push.* Nothing recomputes behind your back: you **run to** a node
and the core processes it plus its transitive upstream in topological order,
memoising (`done` with live outputs is skipped) — but memoisation is for the
*transitive upstream*, **never the explicitly-pulled target**: "run to here"
is a direct request, so a green target always re-runs (the persisted-cache
fast path still applies — persist *is* "serve cached"). Every node carries one
of six streamed statuses — `idle · queued · running · done · stale · error` —
the only thing the editor colours by.

- **`stale` = inputs changed, result deliberately kept.** When a node re-runs,
  everything reachable downstream (its own downstream *and* parallel branches
  off a shared ancestor) is aged via `markStale`: the in-memory output **stays
  visible** (amber, "click to re-run"), and the control re-derives. Correctness rider: a
  `stale` node's **persist cache file is dropped** — `stale` isn't memoised,
  so a surviving outdated cache would be silently restored instead of
  recomputed. `reload` reuses this exact semantic (a structural delta is just
  "an input moved").
- **You can't execute past an error.** `runOne` never rethrows (a throw
  strands every later-planned node in `queued` forever). `process()` instead
  blocks any node whose edge inputs failed/produced nothing — surfaced as
  `error` "Blocked — upstream "X" failed", cascading to dependents.
  Independent branches still run. Headless `cocoon run` exits non-zero **only
  if the requested target itself** failed.
- **Three deliberately-distinct ways a result clears:** *persist toggle off*
  deletes the on-disk cache **only** (live result + `done` stay); *trash*
  (`invalidate`) is a hard reset (drop output + cache → `idle`), offered on
  any node with something to discard; *`stale`* is the automatic one above.
- **Persist is a runtime/session override, never YAML.** The toggle sends
  `setPersist`; the core holds it in an in-memory `persistOverride` and
  streams the *effective* persist in node-state. Not written back to
  `cocoon.yml` (breaks the lossless contract; there is no save path); resets
  on core restart.
- **Contextual actions are framework-light + extensible.** `CocoonNode`
  renders a hover-revealed floating toolbar (▶ run-to-here, persist, 🗑
  trash, …); each is one pure descriptor in a single `actionList`. The
  editor↔core seam is a typed Svelte context (`nodeActions.ts`) so custom
  nodes deep inside Svelte Flow reach the core without prop-drilling.

## Key decisions (architectural keystones)

1. **Svelte 5 + Svelte Flow, not React.** `@xyflow/svelte` v1 and
   `@xyflow/react` v12 are co-released by the same company under the same
   model — maturity is not a differentiator. Chosen for long-term maintainer
   preference and to avoid deeper React lock-in.
2. **There is exactly one render contract — the control render hook. No View
   layer exists.** A visualisation is a **control with a render hook and no
   `event`**; a selectable one adds `event`. The data+render split survives
   as `control.data` (pure, core-side, bounded) + `export const hook` (an
   imperative `mount/update/destroy` renderer depending on nothing —
   ECharts/D3/canvas/DOM), only the bounded payload crossing the wire (~20
   line `controlAction` shim). LiveView is the guiding light **including its
   `phx-hook` escape hatch**. A node is **one co-located source file** —
   `process` + `control.{data,render,event}` (Node side) **and**
   `export const hook` (the browser render half). The core esbuild-bundles
   *only* the `hook` export (`core/control-hook-bundle.ts`, tree-shaking the
   Node side) and serves it over HTTP (`serve.ts`
   `GET /hook/<type>?m=<mtimeMs>`); the editor dynamic-`import()`s it **by
   convention from the node type — no registry**, the `?m=` being the browser
   twin of the resolver's keystone-6 `?m=<mtime>`. The four legacy built-in
   views are ordinary control nodes in `core/nodes/`
   (`Scatterplot`/`Inspector`/`Sparkline` = `control.data` + a zero-dep
   `hook`; `Image` = render-only, no hook — a `<img>` is inert HTML). Proven
   end-to-end by `sandbox/charts` (all four) and `sandbox/tagcloud`
   (`wordcloud`, a pinned CDN URL in the node's own source, fetched + inlined
   at bundle time — no local dep). The YAML `view:`/`viewState` keys are no
   longer interpreted; they round-trip losslessly as ordinary unknown
   pass-through keys (keystone 3), so a hand-edited `boardgames.yml` still
   never churns.
3. **The YAML grammar + lossless round-trip is mandatory** (scope: the
   grammar/round-trip is the contract, not legacy behaviour). The hand-edited
   `boardgames.yml` (and `examples/*`) must load and round-trip losslessly. No
   in-app text editor — the graph editor sits side-by-side with a real text
   editor, so round-trips must not churn hand-edited files. Flow *content* is
   fair game (we own the producer) — but never via lossy round-trips.
4. **The prototype is isolated.** `prototype/`, pnpm, Vite, fresh toolchain,
   outside the dead yarn/lerna workspace.
5. **Controls are a first-class node concept (the Annotate trick, done
   right).** Legacy annotation piggy-backed a view's `send`/`receive` +
   `syncViewState` onto eager auto-process; the revival deleted both crutches
   (pull-only; nothing control-related is read from or written to YAML). The
   principled mechanism:
   - **State is a runtime overlay, never YAML.** Like `persistOverride`,
     streamed as the effective value, resets on restart. Nothing
     control-related is ever saved (no save path; lossless contract forbids).
   - **Durability is ordinary node I/O, not control state.** The side-file is
     the node's own data plane; the control is just the trigger; the node's
     normal `process()` folds the file back in. Ephemeral control + durable
     node I/O, cleanly separated.
   - **Schema is code-declared — the one narrow registry-free exception.**
     Ports stay YAML-structure-derived; a steering control's
     modes/default/form-shape live in node code and stream to the editor in
     node-state. Don't "fix" this by putting control defs into
     `cocoon.yml` (breaks the contract, no save path).
   - **The action tier is free-form streamed HTML, NOT `invokeControl`** (the
     original op-with-correlated-result plan was superseded — do not
     reintroduce). The node *is* the control (same module): core-side
     `control.data(ctx)` (bounded; reads resolved inputs, the node's durable
     file, `ctx.output` = the node's frozen pull-output) → `control.render`
     → HTML, optionally + author JS hooks (the LiveView `phx-hook` analogue —
     the one disciplined render-code+deps delivery path; a
     visualisation/selection is this with no/an `event`) per
     `ctx.surface` → `control.event` writes the node's own
     durable file + `ctx.markStale()`. HTML streams as
     `NodeState.controlHtml`/`controlWindowHtml`; a generic browser shim
     (`controlAction.ts`) injects it and posts events back via the
     fire-and-forget `controlEvent` WS message; reserved `$mount` is the
     Phoenix-`mount` lifecycle. Detached surface = `ControlWindow.svelte`.
   - **No rerun; derive, don't cache (hard-won — DON'T re-propose).** A
     control event NEVER re-runs `process()` / the graph. `ctx.rerun()` and
     `ProcessContext.control` were **built and deleted**: a control event must
     not re-run the graph, and `process()` must stay a pure transform. The
     control stays live because the core re-derives `control.data()` after
     every event (presentation: pure, bounded, no plan, no cascade; the node
     stays `stale`, the user pulls to fold downstream). Every bug in this work
     traced to caching derived control state; the fix every time was to derive
     from the durable file each cycle and cache *nothing*. The **one**
     legitimate use of the opaque `ctx.control` blob is an *unsaved input
     draft*, not derived state (the in-dialog search query is the canonical
     example: a `search` event sets the draft and re-derives `data()` with no
     `stale`/no durable write; results stay pure derivation; re-annotation
     reuses the durable write event verbatim).
   - **The tier cut is steering vs action, not handler-presence.** *Steering*:
     changes what's on the output port — pure pull, set → `stale` → re-pull,
     zero side-effects. *Action*: the free-form model above. Anything
     universal + runtime-owned (persist, run, trash) routes to the **toolbar
     by definition** — never the control pane; the pane shows only declared,
     per-node knobs.
   - **AI read/write goes via collaboration, not direct control I/O.** The
     human-present free-form loop closes through the **client-presence channel
     + suggestion model** (keystone 7): the agent reads the human's *unsaved*
     control text from presence, does the work, hands back a **suggestion**
     the human Applies — durability stays the human's own Save. Direct
     `controlData`/`controlEvent` agent exposure remains a smaller, separate,
     still-open **autonomous / no-human-in-loop** complement — not a
     re-opening of the collaboration loop.
6. **The code is the flow; `cocoon.yml` is the wiring manifest (every
   meaning-node carries its own code).** "Declarative dataflow in YAML,
   no-code" was a pre-AI constraint. A generic node + custom extension is
   *inheritance* (Template Method: fragile base class). The FP correction:
   **the library offers a vocabulary (functional primitives a node calls),
   not a skeleton (a base to extend).** A bespoke node is a plain
   `process(ctx)` composing primitives — no base, no lifecycle beyond the
   contract.
   - **The bespoke-ness was always there, in the worst place.** A
     `Filter`/`Map` with a predicate *param* is already a one-off node whose
     code is a stringified lambda in YAML (no types, imports, tooling, or
     readable diff). The pivot relocates code that already exists into honest
     files. **The line:** if a node's YAML carries a code-shaped param, it
     should be a file.
   - **Generics stay; the line is "generics with controls".** Mechanism nodes
     (`ReadCSV`, `Download`, `Pipe`, `Run` — reusable, no domain meaning, no
     code param) remain generic. **Controls are only introduced for custom
     nodes**, never bolted onto generics. Generic functionality migrates into
     functional primitives over time — direction, not deadline.
   - **Config-shaped `in:` is wiring, not a port — and not a control either.**
     Legacy made everything a port because ports were the only value channel;
     piping `path: ratings.json` from a node is visual-programming theatre. A
     control is also the wrong home (control state is ephemeral by design;
     essential config must persist in versioned YAML — which a literal `in:`
     param already is). The rule: an `in:` key is a connectable **port iff its
     value is a `cocoon://` edge**; a purely literal value is **config** —
     kept verbatim, shown as the title slice, **no handle**. The grammar's
     edge-vs-literal split is the sole discriminator (no schema, no per-node
     config list); registry-free holds. Converting config→port is a one-line
     YAML edit, not a drag; there are deliberately no empty input stubs.
   - **This reframes the lossless contract's *purpose*, not its rules.**
     Losslessness now protects the hand-edited *wiring*, not a behavioural
     spec. Same mechanism (editor owns only edges + `editor.col/row`).
     `cocoon.yml` is the flow's wiring; the nodes' code is the flow.
   - **Resolution completes "registry-free".** No registry map, no
     `package.json`/`cocoon.nodes` lookup. `type: X` resolves by convention
     to a file `X.{ts,js,…}` across three roots in no privileged order: (1)
     the core-internal node dir, (2) a `nodes/` dir next to the cocoon file,
     (3) extra dirs the cocoon file declares (a hand-authored pass-through
     `nodeDirs:` key, for shared node repos like tibi's). **Type-name
     collisions across roots are a categorical hard error, never shadowing.**
     Loading is **pull-triggered, execution-time, mtime-keyed**:
     `resolve(type)` runs when a node runs; the module is re-imported only if
     its file mtime changed (a `?m=<mtime>` specifier — the ESM cache is
     URL-keyed, so the *key* busts it; re-calling `import()` alone does not).
     This **is** keystone-6's hot reload, but pull-triggered, not
     watcher-triggered. **Scope (load-bearing): "no watcher" governs node
     *module code* only** — it does **not** bar watching the *flow file*
     (a wiring edit has no pull trigger and reloading runs zero computation;
     `serve` watches it — see the `reload` guardrail). Two distinct
     mechanisms, one rule each. Per-module isolation is automatic + lazy: a
     broken module fails only its own node, only when pulled. No `serve`
     restart for node-code edits — only core-runtime code still needs one.
   - **Only affordable because of AI; pays AI back.** AI makes "every
     meaning-node is bespoke" cheap (it writes the one-off faster than a human
     finds and configures a generic), live, no restart. In return, bespoke
     nodes + AI-read/write controls give the agent a typed per-node *act*
     surface. The two reinforce; neither stands alone.
7. **Client presence is an optional, orthogonal collaboration side-channel —
   the core relays it and interprets nothing.** Each client (an editor tab, a
   headless agent) MAY announce an opaque blob of its own ephemeral UI state;
   the core (`core/presence.ts` `PresenceHub`, wired in `serve.ts` — **not**
   `Runtime`) collects it per-connection, rebroadcasts the snapshot, drops it
   on disconnect. **Nothing in processing / the pull graph / persistence / the
   lossless contract depends on it** — that decoupling is the whole point (the
   rejected alternative: threading the human's live input through the per-node
   `ctx.control` blob, entangling presence with the load-bearing control
   path). The AI is *a peer client*, not a privileged observer.
   - **The suggestion model (the human↔AI write path).** The agent does not
     mutate the human's state. It reads the human's *unsaved* control text
     from presence (`controlDrafts[node][field]` — the uncontrolled textarea,
     never scraped, never saved) and announces a **change-set** as its own
     presence. The editor surfaces it as ONE generic, node-agnostic toast
     (`SuggestionToast.svelte`); Apply injects each `{node,field,value}` by
     the form-field `name` convention (no node code, no schema — keystone 6:
     read the module for field names), atomic + drift-validated. The verdict
     rides back in the *editor's own* presence — **no new message types, the
     core stays a dumb relay**. Durability is unchanged: Apply persists
     nothing; the human's own Save + a re-pull is the only durable path.
   - **Also the built substrate for the deferred brushing & linking.** A
     control's selection (a `control.event`) becomes one more field a client
     announces; linking is peers re-styling off observed presence. Build it
     on presence, not a bespoke channel — and not by re-adding the removed
     `selectedRanges` form.
   - **The don't-list.** Presence is **never** a data path (`controlDrafts`
     is UI text, not a port; Apply writes nothing durable) — don't make
     processing read or gate on it. Connection-keyed, **evaporates on
     disconnect** (a one-shot `cocoon suggest` holds its socket open so its
     proposal outlives the call) — don't add a TTL/grace, persist it, or
     write any of it to YAML. Keep it in `serve.ts`/transport, **never in
     `Runtime`**.

## YAML backwards-compat contract

The grammar is ported **verbatim** from legacy `@cocoon/util` (regexes copied
exactly — do not "improve" them; they define compatibility):

- **Port reference / edge:** an `in` value (or array element) matching
  `/cocoon:\/\/(?<id>[^\/]+)\/(?<inout>[^\/]+)\/(?<port>.+)/` is an edge
  (`id`.`port` → thisNode.`inKey`). Non-matching `in` values are **literal
  params** (code strings, nested objects/arrays) preserved untouched. Writer
  always emits `cocoon://<id>/out/<port>`.
- **CocoonFile root:** `env?`, `description?`, `nodes`, plus any unknown
  top-level keys — all preserved. The keystone-6 `nodeDirs:` key is one such
  hand-authored, pass-through key (like `env`); the editor never writes it.
- **Node def:** `'?'`/`description` (docs), `editor:{actions?,col?,row?}`
  (a **grid**, not pixels), `in`, `out`, `persist`, `type` (required), plus
  any unknown keys. Legacy `view:`/`viewState:` are no longer interpreted
  (there is no View layer) but, like every unknown key, round-trip verbatim.
- **Lossless rule:** the editor *owns only* (a) `in:` edge references and
  (b) `editor.col/row`. The serializer deep-clones the parsed file and mutates
  only those; everything else passes through verbatim. Grid↔pixel via
  `COL_W=320 / ROW_H=240`. `editor` is written back only if it already existed
  or the node was actually moved (no churn on untouched files).
- Back-compat tests read the canonical repo `examples/*/cocoon.yml` (single
  source of truth) via Vite `server.fs.allow:['..']`; the app loads the same
  files via `import.meta.glob(..., '?raw')`.

## Layout

`prototype/` (active) — a pnpm/Vite Svelte app plus a standalone Node core;
the file count is small, so navigate by reading. The folder split:

- `src/lib/` — the editor and the shared editor↔core seam. `cocoon-uri.ts`
  (verbatim grammar ports), `cocoon-file.ts`/`definition.ts` (load/serialize;
  `inPorts` is the config-vs-port filter), `protocol.ts` (the *entire* WS
  protocol — one graph push + one node-state stream + the keystone-7 presence
  channel; the core imports it **type-only**; agent docs live in
  `.claude/skills/cocoon/SKILL.md`), `coreClient.svelte.ts`, the Svelte
  editor (`App.svelte`/`CocoonNode.svelte` + `nodeActions.ts` seam,
  `FitOnLoad`, detached `ControlWindow`, `SuggestionToast`), and the
  framework-agnostic browser shims (`control-render.ts` — the sole
  `ControlHook` render contract; `controlAction.ts` — the hook-aware
  streamed-HTML shim; `controlHookLoader.ts` dynamic-`import()`s a node's
  `hook` **by convention, no registry**, wrapped by `hookStore.svelte.ts` —
  the **one** reactive resolver both the inline node and the window use).
  `__tests__/` is vitest.
- `core/` — the standalone Node core (`node core/cli.ts`, no build).
  `contract.ts` is the node-author API (`ProcessContext` a *pure* transform,
  `ControlContext`/`ControlRender`, `ControlHook`, `ctx.output`,
  `ctx.resolvePath`, `ctx.processTemporaryNode`); `runtime.ts` is the engine;
  `resolve-nodes.ts` the keystone-6 convention resolver; `nodes/` the zero-dep
  built-ins (incl. the four visualisation nodes
  `Scatterplot`/`Inspector`/`Sparkline`/`Image`);
  `control-hook-bundle.ts` the keystone-2/5 delivery seam (esbuild-bundles a
  node's co-located `hook`, CDN deps fetched+inlined at bundle time);
  `presence.ts`+`serve.ts` the
  transport (an `http.Server` carrying the WS *and* `GET /hook/<type>`;
  presence **and** the flow-file watcher live here, **never `Runtime`**);
  `introspect.ts`/`query-client.ts`
  the AI read/act surface; `run.ts`/`cli.ts` the headless + agent mouths.
- `sandbox/` — non-canonical scratch flows (NOT a back-compat fixture;
  side-files gitignored). `rate/` (`RateGames` + downstream `RatingHistogram`)
  is the reference impl for both control tiers — the free-form/`control.data`
  model, the opaque draft blob, and a render-only control (no `event` half).
  `tagcloud/` proves the CDN-dep hook path; `charts/` exercises the four
  migrated visualisation nodes. Run via
  `pnpm core serve sandbox/<flow>/cocoon.yml`.

`packages/` (legacy reference, **do not build**) — the yarn4/lerna `@cocoon/*`
monorepo + `examples/`. The examples are a capability roadmap, not yet a
compat surface; **`examples/clab`** is the exception: the AI-debug-loop
regression fixture (a clustering node over BGG-shaped `{id, document}` rows).
(`testing` is deliberately dropped — Cocoon is not a test runner; its
`Puppeteer` node passed a non-serialisable browser context node-to-node,
violating the all-port-data-is-serialisable keystone. Don't resurrect.)

## Commands

Run from **`prototype/`** (its own `package.json` pins `pnpm@11.1.0`):

- `pnpm dev` (editor) · `pnpm check` (svelte-check) · `pnpm test` (vitest) ·
  `pnpm build`
- `pnpm serve` — start the core for `simple-api` on `ws://localhost:4000`
  (then `pnpm dev` in another terminal; click a node to process it).
- `pnpm core serve <file> [--port N]` / `pnpm core run <file> --target
  cocoon://N/out/p [--format json|table]` — core for any file / headless.
- `pnpm core query [--core ws://…] <overview|node|upstream|downstream|peek>
  [args]` / `pnpm core set-control <id> <key> <value>` (the agent *act*
  surface — `<value>` JSON-parsed; a schema-rejected/pre-resolve write is a
  silent no-op shown as `IGNORED`) / `pnpm core reload` — agent client to a
  *running* `serve`, not a fresh Runtime.
- `pnpm core process <node>` — run a node on the *running* `serve` session;
  blocks until it settles. `pnpm core presence` — read peers' presence.
  `pnpm core suggest <node> <field> <value> [--json …]` — announce a
  change-set, block for the human's Apply/Discard (keystone 7). Full agent
  guide: `.claude/skills/cocoon/SKILL.md`.

## Guardrails / gotchas

- **pnpm only, from `prototype/`.** The repo-root `package.json` pins
  `packageManager: yarn@4`, so pnpm *refuses* anywhere under the repo except
  inside `prototype/` (which has its own `packageManager`) — it refuses, it
  is not missing.
- Don't touch the legacy `packages/` or attempt to build it; it's reference.
- The grammar regexes in `cocoon-uri.ts` are compatibility-critical and copied
  verbatim — changing them breaks existing files.
- **Ports are YAML-structure-derived, not schema-derived.** Custom modules
  are loaded but the core stays registry-free *by contract*:
  `CocoonProcessNode` deliberately omits `in`/`out`, so a module's port
  schema is ignored. The grammar's **edge-vs-literal split is the sole
  discriminator**: an `in:` key is a connectable input port **iff its value
  is a `cocoon://` edge**; a purely literal `in:` value is configuration
  (preserved verbatim, printed as a title slice, **no handle**). Every `out:`
  key is a statically-seeded output port, plus output ports surfaced by an
  edge — all in file order (`definition.ts`). Node handle ids must be the
  port names (not hardcoded), or Svelte Flow silently drops the edge.
- Environment: Node 25 here. Legacy is Volta-pinned to Node 16.20.2 (ignore).
- **Node-native TS = explicit `.ts` import extensions.** The core runs via
  `node core/cli.ts` (type-stripping, no build), and Node refuses
  extensionless relative imports. Core files and any shared module the core's
  import graph touches use `.ts` specifiers; `tsconfig` has
  `allowImportingTsExtensions` + `noEmit` so Vite/Vitest/svelte-check stay
  happy. `import type` is erased by Node, so type-only imports may stay
  extensionless. A node module that exports a browser `hook` is loaded by the
  resolver in **Node** for `process`/`control` *and* esbuild-bundled for the
  browser for its `hook`, so it must not **statically** import `node:*` or a
  bare/URL browser dep at module top-level — the symmetric-import rule (see
  the dedicated guardrail below). A render-only control that needs core-side
  file access (e.g. `Image`) reads it in `control.data` (async, core-only)
  and exports **no** `hook`, so a top-level `node:fs` import there is fine.
- **Persist cache** is written `_cocoon_cache/<node>.json` next to the
  cocoon.yml (legacy-faithful; travels with the project, enables offline;
  gitignored so it never dirties fixtures). Disabling persist, trash, and
  `markStale` all delete the file.
- **Flow-relative paths go through `ctx.resolvePath`, never a re-derived
  `path.resolve(path.dirname(cocoonFilePath), …)`.** The core deliberately
  does **not** `chdir` to the flow dir (global mutable state breaks headless
  multi-run / the file-watcher / concurrent flows — settled, don't
  reconsider). A node touching the filesystem uses the single injected
  primitive `ctx.resolvePath(...segments)` — on **`ProcessContext` *and*
  `ControlContext`**, backed by one `Runtime.resolveFlowPath` (so a contract
  change is absorbed there, not in N nodes): `path.resolve` semantics
  (absolute segments win), leading `~`→`$HOME`, **no args ⇒ the flow dir**.
  `cocoonFilePath` stays only as the rare escape hatch for metadata the
  resolver doesn't model (e.g. tibi `Slugify` needs the cocoon basename for
  its `.cache_<basename>/` ledger *name*). Don't reintroduce the raw
  incantation; don't add per-kind path helpers (`PROJECT_ROOT` stays
  node/env-level: `ctx.resolvePath(process.env.PROJECT_ROOT ?? '.', f)`).
  Test mock contexts must include `resolvePath` or path-touching nodes throw.
- **Persist toggling is a runtime override — never write it to YAML.** Lives
  in the core's in-memory `persistOverride`, resets on restart. Emitting
  `persist:` into `cocoon.yml` breaks the lossless contract; there is no save
  path — don't.
- **Controls: the don't-list.** Control state is a runtime overlay — **never**
  write it to `cocoon.yml`. Steering *schema* is code-declared and streamed —
  **don't** derive it from YAML structure; a free-form control has **no schema
  at all** — **don't** add one (the node's source is the contract). The tier
  cut is steering vs action, not handler-presence — **don't** put a
  universal/runtime knob (persist, run, trash) in the control pane. **Don't**
  reintroduce `invokeControl`; **don't** add `ctx.rerun()` or
  `ProcessContext.control` (both built and **deleted** — a control event must
  not re-run `process()`/the graph, and `process()` stays a pure transform;
  the core re-derives `control.data()` instead, which is presentation).
  Author render code reaches the browser **only via the one disciplined hook
  delivery path** (the LiveView `phx-hook` analogue) — **don't** scatter
  ad-hoc `<script>` per control, **don't** ship Node-module code client-side
  (no `fs`/`pg` in the browser). There is no View layer to "port" anything
  to; a visualisation is just a control with a render hook and no `event`.
  **Don't** cache derived control state (a cursor/batch) — derive from
  the durable file every cycle; the file is the single truth (every bug in
  this work was a caching bug). Durable data is the node's own I/O — **don't**
  stuff it into control state. **Control render text is UI, not docs, and
  terminology matters:** don't restate pull/stale mechanics in a control's
  HTML (the graph already shows state by colour, so a hard-coded "node is
  stale — pull to …" string is an outright lie when the pulled node is
  green); don't call the pull *"commit"* (the durable write already happened —
  the node's own I/O wrote the file; the pull only folds it downstream). Keep
  control copy to the irreducible (a terse drift count + the affordances) and
  let the graph speak for state.
- **Presence: orthogonal, never load-bearing.** Lives in
  `serve.ts`/`presence.ts`, **never `Runtime`**; the core relays the opaque
  blob and interprets nothing. Don't make processing read or gate on it;
  don't treat `controlDrafts` as a data path; don't persist it, add a TTL, or
  write any of it to YAML (connection-keyed, evaporates on disconnect —
  `cocoon suggest` holds its socket open by design). The verdict rides back
  in the editor's own presence — don't add a reply message type.
- **Never write `$state` synchronously from a DOM event a render can fire —
  the controlAction freeze.** A control event swaps `innerHTML`; that removes
  the focused element and fires `blur`/`focusout` synchronously inside
  Svelte's flush. A handler there that writes `$state` re-enters the scheduler
  → Svelte 5 aborts reactivity: **whole UI frozen, ~0 CPU, console quiet,
  reload-only recovery** (the scheduler is dead, not looping). Hence draft
  capture is **`input` only, deferred via a timer** (never `blur`/`focusout`).
  The rule generalises: a DOM-event handler a render can trigger must not
  touch `$state` synchronously.
- **`runOne` must never rethrow.** A throw aborts the whole plan loop and
  strands later-planned nodes in `queued` forever. Record the failure as
  `error` and return; `process()` blocks dependents and is the sole owner of
  the headless non-zero exit (keyed off the *target* only).
- **Out-of-band node crashes are the node's, not the core's.** A node doing
  async I/O can throw with nothing awaiting it (the real case: `pg` throwing
  from a TLS socket handler) — an `uncaughtException`/`unhandledRejection`
  that bypasses `runOne`'s catch. `core/node-guard.ts` reroutes it onto the
  running node (one process-lifetime listener; attribution is unambiguous
  because the plan loop is strictly sequential); a straggler with no active
  node is logged, never fatal. `cli.ts` owns the headless exit explicitly so
  the guard doesn't swallow the deliberate target-failure rejection. Don't
  make the guard per-node or let it swallow when a node *is* active.
- **`markStale` must drop a persisted node's cache file.** `stale` isn't
  memoised; a surviving outdated cache would be restored (at **load** via
  `hydratePersisted` as well as in `runOne`) instead of recomputed — a silent
  stale-data bug. Conversely it *keeps* the in-memory output so the
  last result stays visible — don't "tidy" that into a full reset (that's
  trash's job, a different intent).
- **Persist-cache I/O must stream, never `JSON.stringify`/`JSON.parse` the
  whole output.** A 153k-row / ~542 MiB cache overflows V8's
  536,870,888-char string cap (`RangeError: Invalid string length`).
  `core/persist-cache.ts` emits item-by-item (bytes identical to
  `JSON.stringify(ports)`) and reads via a chunked, compacting
  recursive-descent parser. The old `JSON.parse(readFile(..,'utf8'))` threw
  and a bare `catch {}` silently recomputed — the catch now logs (ENOENT
  expected; anything else loud). Don't reintroduce `readFile`-as-one-string,
  whole-blob `JSON.parse`, or a silent catch. Restore is **not lazy**:
  `hydratePersisted()` runs it for every persisted node at load/reload.
- **Multi-edge ports concatenate — verbatim legacy `getPortData`.**
  `in: { data: [cocoon://A/out/x, cocoon://B/out/y] }` feeds the node
  `A.x ⧺ B.y`: `resolveInputs` drops `undefined` producers, then
  `present.length <= 1 ? present[0] : present.flat()` — `Array.flat()`
  (depth 1) **is** lodash `_.flatten`. Nodes receive a **flat list** and must
  never re-flatten themselves (the fix for the boardgames `Annotate ←
  SortByRank/out/{data,unsortable}` failure was *here*, not in the node — a
  per-node patch was reverted as a symptom fix). Don't "simplify" this back
  to nesting — it silently corrupts every multi-edge node's input.
- **`reload` re-reads the flow *selectively*; node *code* is hot-swapped by
  the resolver (keystone 6).** `reload` re-parses the YAML, re-extracts edges,
  then `applyReloadDiff` keeps the computed result of every node whose own
  *compute signature* **and** entire transitive upstream are unchanged:
  self+upstream unchanged → **preserved** (output kept; the control
  re-derives on the next pull/event); self unchanged but an upstream moved →
  **`stale`** (last output kept visible); own def changed / brand-new →
  **reset `idle`**; removed → **purged**. Then `hydratePersisted()` brings
  still-persisted *reset* nodes back `done` from disk (preserved ones skipped
  — a 542 MiB result is never needlessly re-read). The signature is
  **compute-only**: `type` + `in` (literal config *and* edge wiring) + static
  `out:`; it deliberately **excludes** `editor`/`?`/`persist` and any unknown
  pass-through key (legacy `view:`/`viewState:` included), so moving a node or
  editing a comment costs zero state. **Conservative by construction**: a
  false *reset* only costs a re-pull; a false *preserve* shows stale data as
  fresh — so anything not provably unchanged is reset, and a changed
  *persisted* node has its now-stale-def cache **dropped before `hydrate()`
  runs**. A `nodeDirs`/`env` change → full-reset fallback. **Don't** loosen
  the signature, **don't** drop the drop-cache-before-hydrate ordering,
  **don't** cache the diff, **don't** move the watcher into `Runtime`. Node
  *code* is **not** reloaded by `reload` and needs no `serve` restart — the
  resolver re-imports a module at execution time when its mtime changed
  (`?m=<mtime>`; the ESM cache is URL-keyed). **"Execution time" includes the
  control loop, not just a pull:** `controlEvent` calls the mtime-keyed
  `resolver.resolve()` (every `$mount` when a window (re)opens, and every
  control event), so a `control.{data,render,event}` / `STYLE` / `hook` edit
  is live on the next control cycle with **no pull, no `reload`, no serve
  restart**; a broken mid-edit falls back to the last-good cached module.
  `controlStatePatch` deliberately stays `peek()` (cache-only, sync): it is
  *always* called right after a `resolve()` (the pull path or `controlEvent`),
  so `modCache` is already fresh — and it also runs on process-completion (a
  hot path) where adding `resolve()` is redundant **and** perturbs the
  tested foreground-vs-`hydrate()` race. So: hot-reload is owned by
  `controlEvent`; don't move a `resolve()` into `controlStatePatch`, and
  don't "optimise" `controlEvent` back to `peek()` (either reintroduces the
  restart-to-see-control-changes bug or the hydrate-race regression). The
  only thing still needing a `serve` restart is **core-runtime** code
  (runtime.ts/resolver/protocol).
  Don't reintroduce a registry map, a filesystem watcher for node *code*, or
  a process-wide cache bust; don't make a code change auto-run (mark `stale`,
  the user re-pulls).
- **The *flow file* IS watched — and that is NOT the node-code watcher the
  line above bars.** `serve.ts` `fs.watchFile`-polls the `cocoon.yml`
  (legacy-faithful, zero-dep; it stats the *path*, so it survives an editor's
  atomic-save/rename — `fs.watch` would lose the inode) and, debounced (a
  save burst → one reload), runs the same `reloadAndBroadcast` the explicit
  `{t:'reload'}` does. It needs none of legacy's unwatch/rewatch self-write
  guard: the core has **no save path**, so the only writer is the human's
  editor. Lives in `serve.ts`/transport, **never `Runtime`** (like presence —
  the headless one-shot `run` has no clients and must not arm it). A reload
  racing a mid-save file is a complete no-op: `Runtime.reload()` parses into
  locals and commits `yaml`/`file` together only past the throw point. Don't
  move the watcher into `Runtime`, don't add chokidar or switch to
  `fs.watch`, don't "simplify" `reload()` back to assigning `this.yaml`
  before `parse()`.
- **The resolver's first import must stay query-free — vitest trap.**
  `resolve-nodes.ts` `loadModule` appends `?m=<mtime>` **only on a re-import**
  of an already-loaded module; the *first* import is a plain specifier.
  Load-bearing: vitest's esbuild transform fails on a `file://…ts?m=` URL
  (`Transform failed`), so an always-query form silently breaks the **entire**
  test suite. Plain Node handles the query fine; it's only needed to bust the
  URL-keyed ESM cache for a genuine re-import. Don't "simplify" `loadModule`
  to always carry the query.
- **Control render hook = single co-located file, delivered — the
  symmetric-import rule is load-bearing (keystone 2/5).** One node module
  exports both the Node side (`process`/`control`) **and** `export const
  hook` (the `ControlHook` browser-render contract). The core's keystone-6
  resolver imports that file in **Node** for `process`/`control`, so the hook
  **must dynamically `import()` its browser-only deps inside `mount`** — and
  those deps are **pinned CDN URLs in the node's own source**
  (`import('https://esm.sh/wordcloud@1.2.2?bundle')`), keystone 6: the node
  carries its own everything, nothing to install, no `node_modules`. A
  top-level static import of a `node:*` builtin **or** a bare/URL browser dep
  crashes one side or the other; the rule both ways: Node-only deps stay
  dynamically imported inside the Node halves, browser-only deps inside
  `mount`. (A zero-dep hook — `Scatterplot`/`Inspector`/`Sparkline` — needs
  no dynamic import at all; a render-only control like `Image` exports no
  hook and may freely use top-level `node:fs` in `control.data`.) Delivery
  (`core/control-hook-bundle.ts`): esbuild `stdin` = `export { hook } from
  <file>` → tree-shakes the Node side; the `httpLoader` plugin fetches &
  **inlines the CDN deps at bundle time** (esbuild leaves `http(s):` external
  otherwise), so the served hook is still one self-contained ESM string,
  mtime-cached. **Trade, accepted deliberately:** a bundle-time network
  dependency + a supply-chain surface (third-party-served bytes inlined into
  what the editor runs) — mitigated by exact-version pinning; internet is
  needed only on first bundle of a given mtime, then cached. (Don't
  reintroduce a local dep + a resolver-bypass: the Yarn-PnP manifests were
  **deleted** — `.pnp.cjs`/`.pnp.loader.mjs`/`.yarnrc*` — so the dead
  workspace no longer leaks into the toolchain *structurally*, not via a
  plugin; `packages/` itself stays as the porting reference.) **Gotchas,
  each cost real time — don't relearn:** (a) esbuild does **not** fetch
  `http(s):` imports natively — it needs the `httpLoader` plugin (resolve
  URL→namespace, resolve a fetched module's sub-imports against its URL,
  `onLoad` fetch); `?bundle` makes esm.sh return one self-contained module.
  (b) `serve.ts` is now an `http.createServer` with the WS
  *attached* (`WebSocketServer({ server })`) — `GET /hook/<type>?m=<mtimeMs>`
  is CORS-open (editor origin ≠ core origin, like the WS); don't revert to
  `WebSocketServer({ port })`. (c) The editor resolves the hook **by
  convention from the node type — there is no registry** (`controlHooks.ts`
  was deleted; `hookFor` dynamic-`import()`s `/hook/<type>?m=`); the `?m=` is
  the **browser twin** of the resolver's `?m=<mtime>` hot-reload — don't
  reintroduce a hook registry or a static hook map. (d) `NodeState.
  controlHook.mtimeMs` is the bust token; it streams only post-resolve (lazy,
  like `controlHtml`). (e) the hook arrives **async, after the HTML** —
  `controlAction` mounts a late hook on the next data tick; don't assume it's
  present at first render. (f) `$state`-write of the resolved hook is in a
  promise callback (a later macrotask), never a sync render-flush write — the
  controlAction-freeze guardrail still applies.
- **One resolver for *both* surfaces — never two (hard-won; every hook bug
  this session lived in the gap between two copies).** The inline node
  (`CocoonNode`) and the detached `ControlWindow` resolve the hook through
  the **single** `hookStore.svelte.ts` `resolvedHook(httpBase,type,mtime)` —
  one function, one reactive cache, two call sites; it *is* "same shim,
  different element". `CocoonNode` gets `httpBase` from the `nodeActions`
  context (`get httpBase`, prop-drill-free, the only thing it needs);
  `ControlWindow` is **pure-props** (App calls the same `resolvedHook` in the
  `controlWindows` derived, passes `hook` down) — it is NOT in the
  Svelte-Flow context and must not depend on it. **Don't**
  reintroduce a per-surface `$effect`/cache or a `loadHook` method. Two
  Svelte-5 traps this cost real time, both now structural: (i) an `$effect`
  that **reads and synchronously writes the same `$state`** is a
  self-referential effect — Svelte silently disables it (the App
  `controlHookCache` effect did exactly this; the window hook then *never
  resolved*). The resolver instead reads a rune `$state` (making the caller's
  `$derived` reactive) and writes it only in the async `.then`, de-duping via
  a **non-reactive** `Set`. (ii) a render hook draws into a
  `position:absolute;inset:0` canvas; if its host's height comes via a
  `height:100%` chain through an `auto`-height ancestor it collapses to a
  **zero-height, invisible** box (the node box resolves a height implicitly;
  `ControlWindow` needed `.mount{height:100%}` over a definite-height
  `.body`). The hook root therefore also carries a defensive `min-height` —
  a render hook must never be a zero box regardless of host CSS. Symptom was
  "inert HTML shows, canvas doesn't" — inspect the hooked element's *computed
  height* first, don't theorise.
- **esbuild is a build-time dep of the delivery seam — pnpm build-approval.**
  `core/control-hook-bundle.ts` needs esbuild's native binary; pnpm 11 gates
  post-install build scripts, so `pnpm.onlyBuiltDependencies:["esbuild"]` is
  pinned in `prototype/package.json`. A fresh clone that still hits
  `ERR_PNPM_IGNORED_BUILDS` just needs `pnpm approve-builds` (or
  `pnpm rebuild esbuild`) once — it is not a code failure.
- **Deferred (out of scope until raised):** multi-control brushing & linking
  (substrate built — detached `ControlWindow`s + the presence channel; the
  first `selectedRanges`-brush prototype was **deliberately removed** — don't
  re-add the range form; build it on presence; a selection is just a
  `control.event`); single-file-HTML editor bundle + `web+cocoon://`
  deep-link; an MCP wrapper of the AI surface (a thin shim over
  `query-client.ts`); a detailed control-authoring **best-practices** guide
  (data/render/event split, draft blob, symmetric-import rule, the
  one-root-selector + native-CSS-nesting styling convention, copy discipline;
  likely an extension of the cocoon skill — the styling guardrail above is its
  seed); Scatterplot preview sampling for very large datasets;
  a `Gallery` visualisation node; direct `controlData`/`controlEvent` agent
  exposure for the **autonomous / no-human-in-loop** case (the human-present
  path is done via presence/suggestion; this is the unattended complement,
  not a re-opening of it). Don't resurrect any without raising it first.
- **Example status / known "no"s** (legacy examples are a roadmap, not yet a
  compat surface): `simple-api`/`noise`/`imdb` run; `interop` fully runs
  (needs python3 + R — an environment dep, not a project concern).
  `custom-nodes`: `ExampleNode` de-lodash'd to zero-dep,
  `DownloadImages`/`MapData` run; **`Wikipedia` is deferred** — `ctx.
  processTemporaryNode` exists, so the only remaining reason it stays a
  non-fatal load failure is the deferred `@cocoon/plugin-distance` npm-plugin.
  A `Gallery` visualisation node (a control with a render hook) is deferred
  until `brushing-and-linking` exercises it. Legacy `view:` keys in
  `examples/*`/`boardgames.yml` are inert (no View layer) but round-trip
  losslessly; converting such a node to a visualisation is a one-line
  `type:`/`in:` edit under co-evolution, not a compat obligation.

## Design ideas (unresolved — not yet decided)

A parking lot for concepts being weighed. **Distinct from "Key decisions"
(settled keystones) and "Deferred" (known scope, just unbuilt): these change
the model and are not agreed yet.** Don't implement from here without raising
it; do append to it.

- **Port-attached filter predicates — RESOLVED, superseded by Controls
  (keystones 5–6).** Recorded so it isn't re-proposed: (1) **wrong unit** — a
  single semantic op ("top-rated only") is node-level intent that fans out to
  multiple ports; a per-port predicate is the wrong granularity. (2) Its
  hardest open question ("can't live in lossless `cocoon.yml`") was a symptom
  of the no-code assumption; once meaning-nodes carry their own code
  (keystone 6) it evaporates. **Don't reintroduce the per-port predicate
  form.**

- **Selection = a row predicate a control emits as ordinary data.** *Channel
  fork now decided (keystone 2/5): a selection is a `control.event` — there is
  no view-shaped return channel because there is no separate View.* The only
  thing every selection has in common is not geometry but "*which records*":
  the render half does geometry → row membership and emits ids/a mask as an
  `event`. Then **linking needs no node** (the set rides the presence layer to
  other open controls, which re-style) and **acting on it needs no special
  node** (materialise it as a column / `ids` and the generic `Filter` consumes
  it — never a bespoke `FilterRanges`). Filter = the durable form,
  mask/highlight = the transient form; same primitive, two intensities. Still
  unresolved: only the filter-vs-mask intensity fork.

- **Function-library / dependency-inversion node model — the eventual
  successor to `ctx.resolvePath` (NOT yet built; do NOT build piecemeal).**
  The recurring tibi-porting friction (a node destructures `ctx` and
  re-derives a contextual capability) is a deeper smell. The destination:
  **`ctx` is an opaque token a node never touches — it is threaded only
  *through* vocabulary functions** the node composes. Two tiers: **pure
  transforms** (`slugify`/`scoreItems`/`sortBy` — no ctx, no I/O; the bulk of
  what migrates out of generic nodes under keystone 6) and a thin
  **effectful-capability** layer (`readJson(ctx,…)`/`writeJson`/`output` —
  the only ctx-touchers). Dependency inversion at the node boundary: a
  contract change is absorbed at the inversion seam, not in N nodes — which
  is *why* it dissolves the porting tax (it goes to zero). `ctx.resolvePath`
  is the substrate this stands on — the library *wraps* it, never replaces
  it; it shipped first alone and deliberately (one clean stopgap it cleanly
  subsumes beats three patterns to reconcile later — don't mix). **The hard
  rule that ships *with* the library: it is *infrastructure*, not flow
  code** — a vocabulary edit needs a `serve` restart (same class as
  `runtime.ts`), because the keystone-6 mtime resolver busts only a node
  module's *own* URL, not its imports (the stale-transitive-copy trap). And
  don't let the vocabulary calcify into a mandatory pipeline DSL
  (`pipe(readJson, map, writeJson)`) — that is the Template-Method *skeleton*
  keystone 6 rejects; it stays plain functions a `process()` calls
  imperatively. Open sub-fork when taken: vendored-per-repo (start here) vs
  one shared importable module.
