---
name: cocoon
description: >-
  Drive and debug a running Cocoon dataflow core as an agent — inspect graph
  state, run nodes, read errors with stack + offending input, and sample port
  data without drowning in it. Use when a Cocoon flow (cocoon.yml) is being
  built or debugged and a `cocoon serve` core is (or can be) running: "why did
  node X error", "what shape is the data on this port", "what's upstream of
  Y", "re-run after I edited the flow".
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
cocoon reload          # re-read the flow file after you edit it
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
  edges, up/down counts. Any attached view payload is digested too — you get
  its shape, never the full (maybe 153k-point) data.
- **upstream / downstream**: `{id,type,status}[]`, transitive, optional
  `--depth`.
- **peek**: row count + per-key `type|presence|example` schema (with
  JSON-string detection), a *small* sample (schema already conveys shape),
  and `--descend FIELD` to follow a JSON-string column one level in.
  `--where`/`--select`/`--limit` carve a bounded slice ("the 3 rows where
  weight is null") — the predicate is evaluated in-core like a `Filter`.

## The debug loop

```
1. cocoon query overview                  → see status; spot the error / loadErrors
2. (find the errored node from upstream/downstream or your knowledge of the flow)
3. cocoon query node <errored>            → error + errorStack + inputDigest (+ errorAt)
4. cocoon query peek cocoon://<upstream>/out/<port> [--descend f] [--where …]
                                          → confirm the actual data shape vs. expected
5. edit cocoon.yml / a custom node file
6. cocoon reload   (graph/param edits)    OR  restart `cocoon serve`  (node/core *code* edits)
7. cocoon query process is via the editor or `pnpm core run`; re-inspect — repeat
```

`inputDigest` is the high-value step: e.g. `data: ‹array [{0,1,2,3}] ×2›`
means the node got an **array of 2 arrays**, not a row list — almost always a
multi-edge port question (see below).

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
  `hello` + `graph` + a full node snapshot before anything you ask. The CLI
  handles this; a custom client must attach its message listener *before* the
  socket opens or it drops that burst.

## The wire protocol (for non-CLI integrators, e.g. an MCP wrapper)

One WebSocket. Minimal by design — the variation is in the payload, not the
message set.

- **Client→core:** `{t:'process',node}` · `{t:'invalidate',node}` ·
  `{t:'setPersist',node,value}` · `{t:'reload'}` ·
  `{t:'query',rid,q}` where `q` is one of
  `{kind:'overview'}` / `{kind:'node',id}` /
  `{kind:'upstream'|'downstream',id,depth?}` /
  `{kind:'peek',uri,descend?,where?,select?,limit?}`.
- **Core→client:** `{t:'hello',file}` · `{t:'graph',yaml}` ·
  `{t:'node',id,state}` (streamed; `state` carries
  status/summary/error/errorStack/inputDigest/errorAt/ports/persist/viewData)
  · `{t:'queryResult',rid,ok,data?|error?}` (correlate by `rid`; replies only
  to the asker).
- `reload` has no direct reply: the core re-reads, then rebroadcasts `graph`
  + a fresh snapshot to **all** clients. Detect completion by waiting for the
  *second* `graph` (connect sent the first).

Build the introspection over `core/introspect.ts` (transport-agnostic:
`overview`/`nodeDetail`/`relatives`/`digest`, and `Runtime.peek`) so a CLI,
this skill, or an MCP server are all thin shims over the same functions.
