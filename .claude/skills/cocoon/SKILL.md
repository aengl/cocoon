---
name: cocoon
description: >-
  Drive, debug, steer, and *collaborate inside* a running Cocoon dataflow
  core as an agent — inspect graph state, run nodes live, read errors with
  stack + offending input, sample port data without drowning in it,
  read/write a node's declared controls, and (the collaboration surface) see
  what control a human has open and what they've typed but not saved, then
  hand back proposed edits as Apply/Discard suggestions. Use when a Cocoon
  flow (cocoon.yml) is being built, debugged, tuned, or co-edited with a
  human and a `cocoon serve` core is (or can be) running: "why did node X
  error", "what shape is the data on this port", "what's upstream of Y",
  "re-run after I edited the flow", "change this node's control and re-run",
  "translate what I pasted into this control", "what's the human doing".
---

# Cocoon: agent ↔ live core

A Cocoon flow is a dataflow graph (`cocoon.yml`). The **core** owns all port
data; clients only ever see *state* (status / counts / bounded digests). That
split is the whole point — a 153k-row port must never cross the wire. This
skill is how an agent interacts with a **running** core.

## Mental model

- **The core is a daemon.** `cocoon serve <file>` loads the flow and holds the
  session: the in-memory port store a `process` fills, persist overrides,
  per-node status. Introspection only makes sense against *that* live process
  — a fresh load would have an empty store.
- **You are a client, not the owner.** Connect, ask, act, disconnect. The
  daemon stays the source of truth. The editor may be connected to the *same*
  core simultaneously; your `process`/`reload` shows up there live.
- **Headless `cocoon run <file> --target …` is different** — it owns its own
  throwaway Runtime and streams one port to stdout. Use it for one-shot
  extraction, not for an interactive debug loop.

## Vocabulary (what the human means)

The human will not use the internal terms below; map their words to these.
The mapping is one-way (human → internal); reply to the human in their own
words.

| Human says…                                     | Means                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **"the flow"** / **"the graph"** / **"the dataflow"** | the cocoon.yml + its live core session                                                         |
| **"a node"** / **"the node"** / **"this node"** / **"the X node"** | a node id (`Cluster`, `RateGames`, …) — look at `cocoon query overview` if unsure |
| **"the form"** / **"the dialog"** / **"the panel"** / **"the popup"** / **"the drawer"** / **"this control"** | the free-form control on the focused node (the HTML `control.render` built — never visible to you; read the module, see below) |
| **"the form I have open"** / **"what I have open"** / **"the thing I'm working on"** / **"the control I'm in"** | `presence` → first peer's `openControls` is the open free-form control; `controlDrafts` is its current content |
| **"these nodes"** / **"the selection"** / **"what I've selected"** / **"the ones I've highlighted"** / **"this rectangle"** / **"the ones in the box"** | `presence` → first peer's `selectedNodes[]` — node ids the human has selected on the canvas (single click, or a shift-drag rectangle). The mirror of your callouts: agent → human is `callout`, human → agent is `selectedNodes` |
| **"this field"** / **"the X field"** / **"the X box"** | one form-field `name` inside that control's HTML — discoverable only by reading the node module (`modulePath`) |
| **"what I typed"** / **"what I pasted"** / **"what I wrote"** / **"my notes"** / **"my draft"** | `presence[…].controlDrafts[node][field]` — the unsaved textarea text verbatim |
| **"a knob"** / **"a setting"** / **"the slider"** / **"the toggle"** / **"the dropdown"** / **"the options"** | a code-declared **steering** control (`query node` → `controls`/`controlState`; write via `set-control`). NOT the same as the form |
| **"run it"** / **"recompute"** / **"re-run"** / **"refresh"** / **"update X"** / **"apply X"** | `cocoon process <node>` on the live session |
| **"reload"** / **"I edited the flow"** / **"pick up my changes"** | `cocoon reload` for YAML/wiring edits; `serve` restart for node/core *code* edits |
| **"suggest"** / **"propose"** / **"fill it in for me"** / **"help me fill out"** / **"draft this"** / **"translate this"** / **"do this with me"** | `cocoon suggest` → one Apply/Discard toast; you write nothing durable |
| **"flag this"** / **"mark this"** / **"point at X"** / **"highlight X"** / **"let me know about Y"** · *also* you wanting to **point them** at a node while explaining ("look at this node — Y") | `cocoon callout <node> "<message>"` → a chat-friendly pointer (label `C1`/`C2`/…). Fire-and-forget; the human's reply belongs in chat |
| **"C1"** / **"C2"** / **"the first callout"** / **"the warning on X"** | one of your own announced callouts, by its short label — see `cocoon presence` for the editor's `calloutLabels` (id → label). To clear it, ask the human to ✕ it in the editor; to amend it, re-announce the same `--id` |
| **"why did X fail"** / **"what's wrong with X"** / **"why is it red"** | `cocoon query node <X>` → `error`/`errorStack`/`errorAt`/`inputDigest` |
| **"what's on this port"** / **"show me the data"** / **"peek at X"** / **"sample X"** | `cocoon query peek cocoon://<node>/out/<port>` |
| **"upstream"** / **"what feeds X"** · **"downstream"** / **"what does X feed"** | `cocoon query upstream <X>` / `downstream <X>` |
| **"the toolbar"** / **"persist"** / **"trash"** / **"clear it"**       | universal node actions on the editor's hover toolbar — NOT controls. Persist toggle is session state; clearing a node is `invalidate` (no CLI today — ask the human to click) |
| **"save"** / **"commit"** / **"persist this"** (in a control context)  | the human's own Save inside the free-form control. The agent never Saves — Apply only fills the field; Save is theirs |

## The CLI (preferred)

Requires a running core (`cocoon serve <file> [--port 4000]`). Default target
is `ws://localhost:4000`; override with `--core <ws-url|host:port|port>` or
`COCOON_CORE`. Exit codes: `0` ok · `1` query failed (`ok:false`) · `2` no
core reachable.

```
cocoon query overview
cocoon query node <id>
cocoon query upstream   <id> [--depth N]
cocoon query downstream <id> [--depth N]
cocoon query peek <cocoon://id/out/port> [--descend FIELD]
      [--where 'x => …'] [--select a,b,c] [--limit N]
cocoon set-control <id> <key> <value>  # steer one declared control (act)
cocoon process <node>                  # run a node on the LIVE session (act)
cocoon reload          # re-read the flow file after you edit it
cocoon presence                        # what other clients are doing (read)
cocoon suggest <node> <field> <value>  # propose an edit; blocks for Apply
      [--json '<ChangeSet|edits[]>'] [--label NAME] [--note TEXT] [--timeout MS]
cocoon callout <node> "<message>"      # drop a chat-friendly POINTER (C1, C2,…)
      [--id ID] [--tone info|warn|error] [--from NAME]
cocoon callout-clear <id-or-label>     # dismiss your own callout from the agent side
```

(From this repo without an install: `pnpm core query …` / `pnpm core reload`,
run from `prototype/`.)

### What each returns (all bounded — size tracks schema/▒limit, never rows)

- **overview** (~700 B even for 125 nodes): file, env, node/edge counts,
  status breakdown, type histogram, source/sink counts, and `loadErrors`
  (custom-node modules that failed to import — a common silent blocker).
- **node `<id>`**: type, status, summary, **`error` + `errorStack`** (where it
  threw), **`inputDigest`** (bounded shape of what the node was fed at throw
  time — usually names the bug), **`errorAt`** (`{index, record}`, exact
  offending item — `Map`/`Filter` only), digested literal params, in/out
  edges, up/down counts. **`modulePath`** — the absolute path of the file
  backing this node's `type`. Use it to **`Read`** the node module: the
  source IS the documentation. This is the *only* way to know a free-form
  control's form fields (names, kinds, expected shapes), since the agent
  never sees the rendered HTML — keystone 6, the code is the doc; same goes
  for understanding what `process()` actually does or what shape it expects
  on a port. Lazy: present once the node has resolved (a `process` /
  `set-control` / persist peek triggers it). **`controls` +
  `controlState`** — the node's code-declared steering knobs (keystone 5):
  the schema (`{kind: toggle|select|text|number, …}`) and the *effective*
  values (override ?? default). Same lazy resolve as `modulePath`. This is
  the read half of the steering-control contract; the write half is
  `setControl` (below). **`controlData`** (free-form controls): the
  *bounded* payload `control.render` built the HTML from — the same slice
  the human is currently looking at. Digested defensively. Read this when
  the human says "fill the form" and `controlDrafts` is empty: it almost
  always contains the current row/selection.
- **upstream / downstream**: `{id,type,status}[]`, transitive, optional
  `--depth`.
- **peek**: row count + per-key `type|presence|example` schema (with
  JSON-string detection), a *small* sample (schema already conveys shape),
  and `--descend FIELD` to follow a JSON-string column one level in.
  `--where`/`--select`/`--limit` carve a bounded slice ("the 3 rows where
  weight is null") — the predicate is evaluated in-core like a `Filter`.
- **set-control `<id> <key> <value>`** (the *act* half — the `query node`
  read half's twin): steer one code-declared steering control. `<value>` is
  `JSON.parse`d so one string arg covers every kind (`true`/`false` → toggle,
  `6` → number, a bare word that isn't valid JSON → the raw string, so
  `manhattan` and `"manhattan"` are equivalent). Prints the authoritative
  post-set `{status, controlState}` and a one-line `set` / `IGNORED` verdict
  on **stderr**. Read the schema first (`query node <id>` — it also forces
  the pull-triggered resolve): a write whose key/value the schema rejects, or
  before the node's module has resolved, is the documented **silent no-op**,
  surfaced here as `IGNORED` with `controlState` unchanged (not an error —
  exit 0; an *unknown node* is the one hard error, exit 1). It is **pure
  pull**: the node (and its downstream) goes `stale`; **re-process the node**
  for the new value to take effect — `set-control` never re-runs anything.
- **process `<node>`** (the *act* surface for running): runs the node + its
  transitive upstream **on the live `serve` session** (the editor's core —
  *not* a throwaway Runtime like `cocoon run`), blocking until the target
  settles `done`/`error`; prints `{status, summary, error?}`. This is the
  editor's "run to here": a green target re-runs (see the pull model). Exit
  1 if the target ends `error`. Then `cocoon query peek
  cocoon://<node>/out/<port>` to sample the fresh output.
- **presence** (read; collaboration): every *other* connected client's
  opaque self-announced blob — `{label, viewport, visibleNodes,
  selectedNodes, openControls, controlDrafts, …}`. How you see **which
  free-form control a human has open** and **what they've typed into it but
  not saved** (`controlDrafts[node][field]` — the live, unsaved textarea;
  never scraped from HTML, never persisted), and **which nodes the human has
  selected on the canvas** (`selectedNodes[]` — a single click, or the
  rectangle from a shift-drag; the mirror of your callouts: agent → human is
  `cocoon callout`, human → agent is this field). Optional + orthogonal: the
  core relays it and interprets nothing; empty ⇒ no peers announcing.
- **suggest `<node> <field> <value>`** (the *act* surface for collaboration):
  announce a **change-set** as your own presence and **block until the human
  Applies or Discards** it (surfaced as one editor toast). Prints
  `{id, verdict: applied|discarded|stale, by}`. `--json` takes a full
  `ChangeSet` or a bare `edits[]` for multi-field / multi-node ("fill this
  in for me") — one change-set ⇒ one toast, applied atomically. Pure
  suggestion: it writes **nothing** — Apply only injects the value into the
  human's (still unsaved) control field; durability remains the human's own
  Save (the node's own I/O) + a re-pull. `stale` = the surface moved on
  before Apply, so the suggestion self-invalidated.
- **callout `<node> "<message>"`** (a pointer, NOT a CTA): drop a marker on
  a node ("still has a `view:` key — remove it?"). **Fire-and-forget**: prints
  the editor-assigned chat-friendly short label (`C1`, `C2`, …) and exits —
  the marker survives because the editor snapshots callouts on first
  observation (the one presence consumer that outlives the socket). Use this
  to point the human at something *while* you're explaining it in chat —
  their reply belongs in chat, not the editor. The header bar's
  ◀ N ▶ steps through them; the node carries a speech bubble above it with
  the message + ✕ dismiss. Re-announcing the same `--id` updates the message
  and resurrects a dismissed callout. `--tone info|warn|error` tints the
  marker; `info` is the default. Refer to a callout in chat by its short
  label ("about C2 — do you want me to remove the view?"), never by the
  internal id. If no editor is connected the label echo doesn't arrive
  (printed `label: null`); a future re-announce will pick one up.
- **callout-clear `<id-or-label>`** — close the loop on a callout from your
  side once the work behind it has been done. Symmetric to the human's ✕.
  Accepts either the chat-friendly short label (`C1`, `C2`, …; resolved via
  the editor's `calloutLabels` from peer presence) OR the opaque internal
  id (`co-…`). Prints `{dismissedId, acked}` (`acked:true` = editor echoed
  back; `acked:false` = announce flushed but no editor confirmed in time —
  the snapshot will still be dismissed if it's there). Re-announcing the
  same id later resurrects (clearing is not destructive).

## The debug loop

```
1. cocoon query overview                  → see status; spot the error / loadErrors
2. (find the errored node from upstream/downstream or your knowledge of the flow)
3. cocoon query node <errored>            → error + errorStack + inputDigest (+ errorAt)
4. cocoon query peek cocoon://<upstream>/out/<port> [--descend f] [--where …]
                                          → confirm the actual data shape vs. expected
5. edit cocoon.yml / a custom node file
   (the node module path is `modulePath` in step 3 — Read it to understand
    the failure or to find the form/field shape, then edit it there)
6. cocoon reload   (graph/param edits)    OR  restart `cocoon serve`  (node/core *code* edits)
7. cocoon process <node>                  → re-run on the live session; re-inspect — repeat
```

## The steering loop (controls)

Distinct from the debug loop: not "why did it break" but "try it another
way". A control is a node's own code-declared knob (keystone 5); steering it
is the agent's *act* surface, the mirror of the `query node` *read* surface.

```
1. cocoon query node <id>          → read `controls` (schema) + `controlState`
                                      (effective values). Also forces the
                                      lazy resolve, so the schema is now known.
2. cocoon set-control <id> <key> <value>   → records a session override;
                                      node + downstream go `stale`. The
                                      printed read-back is authoritative
                                      (`set` vs `IGNORED`).
3. cocoon process <id>            → the new value takes effect (live session).
4. cocoon query node <id> / peek the output   → inspect the new result; repeat.
```

The override is **session-only** (never written to `cocoon.yml` — the
lossless contract, exactly like persist) and resets on `serve` restart.

## The collaboration loop (presence + suggestions)

The human↔AI surface: not "why did it break" or "try it another way" but
"do this bit *with* me". You are just another client; presence is an
optional, orthogonal side-channel (the core relays, interprets nothing,
nothing in processing depends on it). What the human will actually say (per
the Vocabulary table): *"help me fill out this form"* (empty), *"translate
what I pasted in there"* (has text), *"draft something for this"*, *"what's
in this control"*. Empty form and non-empty form are the **same** loop —
presence + module file + suggest. Don't treat an empty `controlDrafts` as
missing input; it just means there's nothing to transform, only to write.

```
1. cocoon presence                → see the human's open control + the
                                     UNSAVED text: controlDrafts[node][field]
                                     (also viewport / visibleNodes / label).
                                     EMPTY controlDrafts is normal — they
                                     just haven't typed; it isn't a blocker.
2. cocoon query node <node>       → read `modulePath`, then Read THAT file.
                                     **You never see the rendered form.** The
                                     form HTML is built by the node module's
                                     `control.render` — the source is the
                                     ONLY way to learn which fields exist,
                                     their `name`s, kinds, and what they
                                     expect. `controlDrafts` shows current
                                     contents; the module shows the schema.
3. Do the work yourself. Two cases:
   a) controlDrafts has text → transform IT (translate / restructure / etc.)
   b) controlDrafts is empty → `cocoon query node <node>` → **`controlData`**.
      That IS the bounded slice the human is currently looking at (the
      input to `control.render`); the "which game is shown" answer almost
      always lives here. If it doesn't (the node's data() omits it, the
      node hasn't been pulled yet, ambiguous request), **ask in ONE
      sentence and proceed**. Don't `peek` upstream to guess.
4. cocoon suggest <node> <field> "<result>"   → ONE editor toast; BLOCKS.
   (or --json a multi-edit ChangeSet for "fill the whole form in".)
5. human clicks Apply  → the value is injected into their (still unsaved)
   field; you get {verdict:'applied', by}. Discard → 'discarded'. If they
   navigated away first → 'stale' (self-invalidated; re-read presence, redo).
6. the human Saves (the node's own control I/O) then you `cocoon process
   <downstream>` to fold it through — durability + the pull are theirs/yours
   to trigger, never the suggestion's. `cocoon query peek` to confirm.
```

**Read the module first; don't guess field names.** Free-form controls have
**no schema** by design (the node IS the contract; keystone 5). The agent's
only window onto a form is `controlDrafts` (current values, keyed by field
`name`) + the module source. An edit is `{node, field, value}` where `field`
**is** the form-field `name` attribute used by `control.render` — invent one
and the human-side Apply silently injects into nothing. Same rule applies
when you're suggesting how to fix a `process()` bug, picking a sensible
`set-control` value, or interpreting an `inputDigest`: read the file.
`modulePath` from `cocoon query node <id>` is how you find it; if it's
missing the node hasn't resolved yet — run `cocoon process <node>` first.

Key properties to rely on: a suggestion **persists nothing** — Apply only
fills the human's uncontrolled field; the durable write is still their Save.
Re-announcing the same `ChangeSet.id` **supersedes** the toast (presence is
current-state, not an event log). Multi-edit change-sets apply **atomically**
(all-or-nothing). `controlDrafts` is the human's live text verbatim — read
it, don't HTML-scrape.

`inputDigest` is the high-value step: e.g. `data: ‹array [{0,1,2,3}] ×2›`
means the node got an **array of 2 arrays**, not a row list — almost always a
multi-edge port question (see below).

## The pointing loop (callouts)

Not "do this with me" (that's `suggest`) but "*look* at this while we talk
about it". The graph has hundreds of nodes; "let's discuss the `Annotate
Published` node" reads in chat but the human has to *find* it. A callout puts
a visible marker (badge on the node + ring in the minimap + ◀ N ▶ in the
header that jumps the canvas) on a node, with a free-text message — and gives
your conversation a chat-friendly handle (`C1`, `C2`, …) for it.

```
1. cocoon callout <node> "<message>" [--tone info|warn|error] [--from claude]
       → editor draws the marker, assigns C1/C2/…, prints {id, label}; exits.
2. you refer to it in chat by its label: "about C2 — the view: on
   AnnotateGames — do you want me to remove it?"
3. the human reads the marker (the popover shows `<message>`), replies in
   chat, dismisses ✕ in the editor when they're done with it.
4. if you change your mind / refine: re-announce SAME --id; the message
   updates in place; a dismissed callout resurrects.
```

**Use this for:** "you asked me to migrate the views — here are the eight
that need work, one callout per node, message says which kind of migration"
· "this node is throwing — I'll callout it as `error` so you can see where"
· "while I explain the four buckets, I'll callout each so you can read
along".

**Don't use this for:** asking the human a question (chat is the channel) ·
proposing an edit (use `suggest`; Apply is the loop, callouts have no
verdict) · spamming every node you touched (one callout = one thing worth
the human's eye). The marker survives until ✕ — keep them rare and they stay
loud.

**Close the loop yourself.** When you finish what a callout flagged, run
`cocoon callout-clear C2` (or the internal `co-…` id) — symmetric to the
human's ✕. Otherwise stale markers accumulate. *Always clear your own
callouts once their work is done* unless the human has already done it
(check `dismissedCallouts` in presence; an id in there is already gone).

The pill at the top-left of a node is a callout; the toolbar at the top-right
is the universal hover actions (copy node id, run, persist, trash). The
header bar's amber `◀ C1 1/3 ▶` is your fastest navigation when you've
flagged several — clicking ▶ glides the canvas onto the next one.

## Gotchas (read before trusting a result)

- **`reload` re-reads the flow file, not node *code*.** It re-parses
  `cocoon.yml`, re-extracts edges, full-resets state (store cleared, all
  `idle`; persisted nodes restore from disk cache on next process), and
  rebroadcasts so the editor repaints. But Node's ESM module cache means an
  edited **node module / core file is NOT hot-swapped** — you must **restart
  `cocoon serve`** for code changes (built-in node, custom node, runtime).
  Graph/param/wiring edits: `reload` is enough.
- **Multi-edge ports concatenate.** `in: { data: [cocoon://A/out/x,
  cocoon://B/out/y] }` feeds the node `A.x ⧺ B.y` — the producers' arrays are
  flattened one level (legacy `getPortData` parity: `len===1 ? d[0] :
  _.flatten(d)`, `undefined` producers dropped). So a node always sees a flat
  list; if `inputDigest` shows an array-of-arrays, suspect a *recent* core
  build that lost this — not the node. Don't "fix" it inside a node.
- **Status is only meaningful after a `process`.** A freshly served core is
  all `idle`; the structure queries still work (they're pre-run).
- **The connect handshake replays everything.** On connect the core sends
  `hello` (now carrying your `clientId`) + `graph` + a full node snapshot +
  a `presence` snapshot, before anything you ask. The CLI handles this; a
  custom client must attach its message listener *before* the socket opens
  or it drops that burst (the `hello` is in it — miss it and you never learn
  your `clientId`, so you can't filter your own presence echo).
- **`process`/`suggest` have no correlated ack** (the `setControl` family).
  `process` resolves by watching the streamed `{t:'node',id:target}`
  broadcasts until a *settled* terminal status; `suggest` resolves by
  watching peer `presence` for a `resolvedSuggestions` entry with your
  `ChangeSet.id`. Anchor on the value, never a positional message count.
- **Presence is optional + orthogonal — never build correctness on it.**
  It's connection-keyed and **evaporates on disconnect** (a one-shot
  `cocoon suggest` keeps its socket open precisely so its proposal survives
  until answered). The core relays the blob and interprets nothing; a peer
  may announce nothing at all. It is *never* a data path — `controlDrafts`
  is the human's unsaved UI text, not a port; Apply persists nothing.
