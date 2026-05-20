---
name: cocoon
description: >-
  Drive a Cocoon dataflow as a peer alongside the human: edit `cocoon.yml`
  and node modules, inspect graph state, run/steer nodes, peek at port
  data, and collaborate via presence (suggestions, callouts). Read when
  you're in a repo with a `cocoon.yml` and/or a `cocoon serve` core is
  reachable.
---

# Cocoon

**Agent-first, flow-based data processing.** A collaborative data-mining
environment where the agent builds the graph and the human steers and
monitors — and the same flow carries you from raw data to insights to
running workflow automation, in one tool.

You are working inside a Cocoon project: a directory containing a
`cocoon.yml` (the **flow**), possibly a `nodes/` dir with the node modules
it references, and (typically) a running `cocoon serve` core that the
human's browser editor is connected to. You are a **peer client** of that
same core, alongside the editor — never a privileged observer. Connect,
ask, act, disconnect; the core stays the source of truth.

## What the human sees

A browser canvas shows the flow as a graph of nodes coloured by status. The
canvas is read-only — edges are not drawn by hand. To change the flow,
either:

- **the human** opens `cocoon.yml` in their own text editor and edits YAML
  alongside the canvas; the core watches the file and reloads with minimal
  disturbance, or
- **you** (the agent) write the same file via raw `Edit`/`Write`, and/or
  announce **suggestions** — change-sets the human applies with one click.

Each node carries a hover toolbar (run-to-here, persist, trash, …) and may
carry a **control** — a code-declared affordance attached to the node
(a steering knob, a chart, a form, an annotation UI). A control renders on
two **surfaces**: inline on the node itself (`surface: 'node'` — compact)
and in a detached **window** (`surface: 'window'` — roomy). You may also
drop **callouts** — chat-friendly speech bubbles pointing at a node,
stepped through by ◀ N ▶ in the header.

## Vocabulary

- **Flow** — a dataflow graph persisted as a single `cocoon.yml`.
- **Node** — one data-processing operation. One co-located source file:
  `process` (Node-side transform) + optional `control.{data,render,event}`
  (Node-side) + optional `hook` (browser-side renderer). Plain JS/TS, no
  build step.
- **Port** — a node's input/output channel. An `in:` key whose value is a
  `cocoon://` URI is an **edge** (port-to-port wiring); a purely literal
  `in:` value is **config** (no handle, shown as a title slice).
- **Edge** — `cocoon://<id>/out/<port>` reference, the only edge form.
- **Control** — first-class node concept, peer to ports. Two tiers:
  - **steering** — typed, code-declared knobs (toggle/select/text/number)
    rendered inline; pure pull (set → `stale` → re-pull, zero side-effects);
    state is an ephemeral core-held overlay, never YAML.
  - **free-form** — server-built HTML, optionally with an author-written
    browser hook. Split: `control.data` (core-side, async, bounded) →
    `control.render` (HTML/+hook, per `ctx.surface` = `'node'` inline or
    `'window'` detached) → `control.event` (durable write + `markStale`;
    a selection is just an event). **No schema — the node *is* the
    control.**
- **Visualisation** — a control with a render hook and no `event`; a
  selectable one adds `event`. Controls *are* the view layer.
- **Hook** — the browser half of a node: an imperative
  `mount/update/destroy` renderer exported from the same source file.

## Architecture: one core, many clients

A standalone, transport-agnostic Node **core** owns the runtime, the
resolver, processing and all port data. The browser **editor** is a pure
viewer (no save path, no edge-connect, no YAML pane) that loads the file
itself and receives only a stream of per-node *state* over one WebSocket —
never bulk data. **You connect to the same core** via the CLI, alongside
the editor; reads, runs, and presence updates are simultaneous and visible
in both.

A separate headless mode (`cocoon run <file> --target …`) owns its own
throwaway Runtime and streams one port to stdout. Use it for one-shot
extraction, not for an interactive debug loop — its state is *not* what
the editor sees.

## The cocoon.yml format

**There is no schema — the loader honours every key it doesn't understand**
(no in-app writer means nothing gets dropped on disk). Shape:

```yaml
description?: 'free text'
env?:         { … }     # available to nodes as ctx.env
nodeDirs?:    ['~/my-project/nodes']  # extra node roots
nodes:                  # required
  <NodeId>:
    type: <TypeName>    # required; resolved by convention (see below)
    '?': 'inline docs'  # optional; also accepted as `description:`
    group?: 'a/slash/path'   # semantic visual cluster
    persist?: true|false     # serve cached output from disk
    in?:
      <portKey>: <edge-or-literal>
      <portKey>: [<edge>, <edge>, …]   # multi-edge: concat
    out?:
      <portKey>: ~      # statically-seeded output port
```

- **Node ids** are the keys under `nodes:`; they are the only identity
  references use. Renaming is `Edit` across the file.
- **`type:` resolves by convention** — no registry. The core looks for
  `<flowdir>/nodes/<Type>.{ts,js,…}` and in any `nodeDirs:` root (leading
  `~/` expands to `$HOME/`). A duplicate type name across roots is a hard
  error (never shadowing).
- **Edge vs config — the grammar's sole discriminator.** An `in:` value is
  an edge iff it matches `cocoon://<id>/out/<port>` exactly; anything else
  is a literal config value (code string, number, nested object/array),
  preserved verbatim and shown as a title slice on the node. There are no
  empty input stubs; converting config↔port is a one-line YAML edit.
- **Multi-edge concat.** `in: { data: [cocoon://A/out/x, cocoon://B/out/y] }`
  feeds the node `A.x ⧺ B.y` (`Array.flat()` depth 1). The node receives a
  flat list and must never re-flatten.
- **Comments and unknown keys are preserved on disk** because nothing
  writes the file. Edit freely; formatting is yours.
- **What is NOT in the file:** persist toggle state, control state, control
  drafts, suggestions — all runtime overlays, ephemeral by design. The
  authoritative source for *what `type` means* is the node module file, not
  the YAML.

## Editing the flow

Edit `cocoon.yml` and node modules as **text**, via raw `Edit`/`Write` —
there is no structural API and no save path in the editor. The core
watches the flow file: a save triggers a **selective reload** (see below).
For an explicit reload after a programmatic edit, run `cocoon reload`.

Node *module code* does not need a reload at all — it is hot-swapped at
execution time by the resolver when its mtime changes. The only thing that
needs a `serve` restart is core-runtime code (the runtime itself, the
resolver, the protocol).

### Reload semantics

`cocoon reload` (and the watcher) re-parse the YAML and apply a selective
diff: per node, comparing its **compute signature** (`type`, `in:`, static
`out:`) plus its entire transitive upstream:

- self + upstream unchanged → **preserved** (output kept)
- self unchanged, upstream moved → **`stale`** (last output still visible)
- self changed / brand-new → **reset `idle`**
- removed → **purged**

Persisted nodes that were *reset* re-hydrate from disk. Editing a comment,
`group`, `?`, or any unknown pass-through key costs zero state. A
`nodeDirs:` / `env:` change is a full reset.

## Execution model

*Pull, not push.* Nothing recomputes behind your back: you **run to** a
node and the core processes it plus its transitive upstream in topological
order, memoising completed upstream nodes. The explicitly-pulled target
always re-runs (the persist-cache fast path still applies; persist *is*
"serve cached").

Six streamed statuses — `idle · queued · running · done · stale · error` —
the only thing the editor colours by.

- **`stale`** = inputs changed, result deliberately kept (the in-memory
  output stays visible; `process` to refresh). Re-running a node ages
  everything reachable downstream.
- **Errors block downstream.** A failed node surfaces as `error`; its
  dependents become `error "Blocked — upstream X failed"`. Independent
  branches still run.
- **Three result-clearing semantics:** *persist toggle off* deletes the
  on-disk cache only (live result + `done` stay); *trash* drops output +
  cache → `idle`; *stale* is the automatic one above.
- **Persist is a runtime override, never YAML.** Resets on `serve`
  restart.

## Talking to the core: the CLI

Requires a running `cocoon serve <file> [--port N]`. Default target is
`ws://localhost:4000`; override with `--core <ws-url|host:port|port>` or
`COCOON_CORE`. Exit codes: `0` ok · `1` query failed · `2` no core
reachable. (Inside this repo, prefix with `pnpm core …` from `prototype/`.)

```
# Read (does not change state)
cocoon query overview                       # status, counts, loadErrors, type histogram
cocoon query node       <id>                # status, error/errorStack/errorAt, inputDigest,
                                            # modulePath, controls/controlState, controlData
cocoon query upstream   <id> [--depth N]
cocoon query downstream <id> [--depth N]
cocoon query peek <cocoon://id/out/port> [--descend FIELD]
      [--where 'x => …'] [--select a,b,c] [--limit N]
cocoon presence                             # other clients' open controls / drafts / selection

# Act
cocoon process <node>                       # run on the LIVE session; blocks until settled
cocoon set-control <id> <key> <value>       # steer a declared knob; pure pull (node → stale)
cocoon reload                               # re-read the flow file after a YAML edit
cocoon suggest <node> <field> <value>       # propose a control edit; BLOCKS for Apply/Discard
      [--json '<ChangeSet|edits[]>'] [--label NAME] [--note TEXT] [--timeout MS]
cocoon callout <node> "<message>"           # drop a chat-friendly POINTER (labels C1, C2, …)
      [--id ID] [--tone info|warn|error] [--from NAME]
cocoon callout-clear <id-or-label>          # dismiss your own callout
```

**All output is bounded.** Even `peek` returns a per-key schema + a small
sample, not the rows; size tracks the schema, never the row count. A
153k-row port never crosses the wire.

**`modulePath` is your way into a node.** Returned by `query node`, it's
the absolute path of the file backing the node's `type`. **Read it** — the
source IS the documentation (the YAML is wiring only). It is also the
**only** way to learn a free-form control's field names: they are HTML
`name` attributes inside `control.render`, which you never see rendered.

**`set-control` and `reload` go `stale` but never run anything.** Run with
`process`. A `set-control` whose key/value the schema rejects, or that
fires before the node's module has resolved, is the documented silent
no-op (surfaced as `IGNORED`, exit 0; an unknown node is exit 1).

**`process` and `suggest` resolve on a value, not a message count.**
`process` waits for the streamed status to settle terminal; `suggest`
waits for the peer presence echo of your `ChangeSet.id`. Both can block
indefinitely — use `--timeout` on `suggest` if the human may be away.

## Collaborating with the human

Presence is an **optional, orthogonal side-channel**. Each connected client
(editor tab, agent) may announce an opaque blob; the core relays it and
interprets nothing. **Nothing in processing depends on it.** Empty presence
is normal — it doesn't mean broken.

Three primitives, each with its own semantics:

- **Suggestion** (`cocoon suggest`) — the human↔AI **write path**. You
  read the human's *unsaved* control text from presence
  (`controlDrafts[node][field]`, never scraped from HTML), do the work,
  and announce a change-set as your own presence. The editor surfaces it
  as one toast; **Apply only injects the value into the still-unsaved
  field** — durability is the human's own Save afterwards. The verdict
  rides back in the editor's presence; `suggest` blocks until you get
  `applied` / `discarded` / `stale` (the surface moved on; self-invalidated).

- **Callout** (`cocoon callout`) — a chat-friendly **pointer at a node**,
  not a CTA. Use it to give your chat conversation a handle: "at C2 —
  should we drop its `view:`?". Fire-and-forget: the editor snapshots
  callouts on first observation, so the marker survives your disconnect.
  The human's reply belongs in chat, not the editor. Close the loop with
  `callout-clear` when the flagged work is done.

- **Reading presence** (`cocoon presence`) — see every other client's
  blob: open controls (`openControls`), unsaved drafts (`controlDrafts`),
  node selection (`selectedNodes` — single click or shift-drag rectangle),
  viewport, label. The mirror of your callouts: agent → human is
  `callout`, human → agent is `selectedNodes`.

**Rules:**

- **Presence is connection-keyed and evaporates on disconnect.** (One-shot
  `suggest` holds its socket open by design until the verdict arrives.)
- **Presence is never a data path.** `controlDrafts` is the human's UI
  text; don't gate processing on it; don't treat it as a port.
- **Free-form controls have no schema.** The node *is* the contract. To
  know which fields exist, **Read** `modulePath`. Inventing a field name
  Applies into nothing.
- **An empty `controlDrafts` is not a blocker.** "Help me fill out this
  form" with an empty draft is the same loop as "translate what I pasted"
  with a full one — just no input text to transform. `controlData` (in
  `query node`) holds the bounded slice the human is currently looking at;
  the "which row is shown" answer almost always lives there.

## How the human refers to things

The human will not use the internal terms above. Map their words; reply in
theirs.

| Human says…                                          | Means                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **"the flow" / "the graph"**                         | the `cocoon.yml` + its live core session                                                           |
| **"a node" / "this node" / "the X node"**            | a node id (look at `query overview` if unsure)                                                     |
| **"the form" / "the dialog" / "this control"**       | the free-form control on the focused node                                                          |
| **"what I have open" / "the thing I'm working on"**  | `presence` → first peer's `openControls`; `controlDrafts` for its content                          |
| **"these nodes" / "the selection"**                  | `presence` → first peer's `selectedNodes[]`                                                        |
| **"this field" / "the X field"**                     | one form-field `name` inside `control.render` — read `modulePath` to learn the names               |
| **"what I typed" / "my draft" / "what I pasted"**    | `presence[…].controlDrafts[node][field]` verbatim                                                  |
| **"a knob" / "a setting" / "the toggle"**            | a code-declared **steering** control — read via `query node`, write via `set-control`              |
| **"run it" / "recompute" / "refresh"**               | `cocoon process <node>` on the live session                                                        |
| **"reload" / "pick up my changes"**                  | `cocoon reload` for YAML edits; nothing for node code (hot-swap); restart only for core code       |
| **"suggest" / "draft this" / "help me fill out"**    | `cocoon suggest` → one Apply/Discard toast                                                         |
| **"flag this" / "point at X" / "highlight X"**       | `cocoon callout <node> "<message>"` — labels `C1`, `C2`, …                                         |
| **"C1" / "the first callout"**                       | one of your own announced callouts, by short label                                                 |
| **"save" / "commit"** (in a control context)         | the human's own Save inside the free-form control. The agent never Saves                           |
| **"the toolbar" / "persist" / "trash"**              | universal node actions (NOT controls). Persist toggle is session state; trash is `invalidate`      |

## Rules to know before acting

- **The flow file is the wiring; the modules are the flow.** YAML edits go
  on `cocoon.yml`. Behaviour edits go on the node module file (`Read` it
  first; `modulePath` from `query node` is the path). Both are picked up
  live.
- **All graph state-changes are pull-driven.** Edits, `set-control`, and
  `reload` only mark `stale`; nothing runs without `process`.
- **The connect handshake replays everything** (`hello` with your
  `clientId` + `graph` + per-node state + presence) before anything you
  ask. The CLI handles this; a custom client must attach its listener
  before opening the socket.
- **A loadError on a node module is a common silent blocker.** Check
  `query overview` → `loadErrors` first when a node won't run.
- **`inputDigest` is the high-value debug field.** A `node` query at error
  time shows the bounded shape of what `process()` was actually fed —
  almost always names the bug. `errorAt` (nodes using
  `trackedMap`/`trackedFilter`) pinpoints the exact offending row.
- **Don't HTML-scrape what the human sees.** `controlDrafts` is the only
  reliable source for current control values, `modulePath` for the schema.
