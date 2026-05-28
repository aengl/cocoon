# Brushing & linking via watched file dependencies — implementation plan

> **Status:** plan, not built. Authored 2026-05-28 (Lynn + Claude). The
> *control-only refresh* half of this design already shipped as
> `cocoon refresh-control` (`core/query-client.ts` `sendRefreshControl` +
> the CLI verb); this plan covers the *output-affecting* half — letting a
> node react to an external file it depends on but has no edge to — and the
> shared core-owned watcher that drives both. The driving use case is
> brushing & linking across nodes; annotation realtime is already solved by
> `refresh-control` and motivates the refresh half here.

## 1. Goal

Let a node declare that its behaviour and/or its control view depend on an
**external file it has no edge to**, so the core watches that file and reacts
on change — **without** breaking the pull-graph invariant that only a pull
runs `process`. Two concrete payoffs:

1. **Brushing & linking across nodes.** Brush a selection in viz A; linked
   nodes B/C that filter on that selection go `stale` (filter case) or
   re-highlight (highlight case). A→B/C is a real dependency with **no edge**
   in the graph (the selection rides a sidecar file, not a port).
2. **Annotation realtime** (already shipped via `refresh-control`, included
   here because it's the *refresh* half of the same mechanism): a node's
   control re-derives from a durable file the agent writes directly.

## 2. The pull-purity stance (read this first)

The instinct to protect is **"no push"** — a file change must never *force a
downstream recompute*. This plan honours that, and the reasoning is sharper
than "don't react to files":

- **`statePatch` (control re-derive) is not push.** It recomputes
  *presentation* — `control.data` → re-render → re-stream `controlData` — and
  touches nothing in the graph: no `process`, no port data, no status change
  (`core/controls-render.ts:136`). The control was always a live *projection*
  of its inputs; refreshing it keeps the projection current. Fully pull-pure.
- **`markStale` is not a recompute-push either — it's the anti-push.** `stale`
  is precisely the pull-graph's way of *not* cascading computation: it ages a
  node to amber and **stops** (`core/runtime.ts:600`, `done`→`stale` only,
  drops the persist cache). Downstream ages too, but nothing recomputes until
  someone pulls. Cascading *staleness* (a passive marker) instead of
  *recomputation* is the whole point.

So neither effect is push. The **real** constraint a watcher introduces is
**legibility**: today every status change is traceable to a visible cause — a
pull, a control/steering change on that node, or a reload. A watcher firing
`markStale` would be the first status change with *no in-graph, no
user-action cause* — B goes amber and the canvas shows no reason. The fix is
not "don't do it"; it's **make the dependency visible** (§7). Ambient
staleness is fine as long as it's legible.

**The hard invariant (write it into the contract):** a watched-file change may
`statePatch` and/or `markStale`, but **never** runs `process`. Pull stays the
sole compute trigger. This is what keeps "react to ambient changes" from
sliding into uncontrolled reactivity.

## 3. Two effects, one mechanism

Both effects already exist in the core. This plan adds a *trigger* (a watched
file changing) that fires them, plus the declaration and the visibility.

| Kind | The file feeds… | Effect on change | Status change? | Example |
|---|---|---|---|---|
| **refresh** | only `control.data` | `statePatch` (re-derive + re-stream) | none | brush *highlight*; annotation JSONL |
| **stale** | `process()` | `markStale(node)` + `markStale(downstream)` | →`stale` | brush *filter* sidecar |

- The **refresh** effect is **already shipped**: it's exactly what
  `control.event` auto-runs (`controls-render.ts:182`) and what
  `cocoon refresh-control` triggers via the `$mount` event. A file watcher
  firing it is pure liveness sugar.
- The **stale** effect is the new work. It's the same cascade
  `ctx.markStale()` already runs inside a control event
  (`controls-render.ts:178-181`): `markStale(id)` then `markStale` over
  `downstream(id)`. The only new thing is the *trigger* (a watcher / an
  out-of-graph signal) and the *index* (which nodes a given file ages).

A node may have both, on different files.

## 4. The medium: file vs presence

A selection can travel between A and the linked nodes two ways:

- **Sidecar file** (`_brush/selection.json`): A's `control.event` writes it; a
  linked node reads it in `process` (filter) or `control.data` (highlight).
  **Durable, agent-writable (raw `Write`/`Edit`), works headless, and — the
  decisive property — readable by `process()`.** This is the path this plan
  builds.
- **Presence** (a `selectedRanges`/`selectedNodes` field, `protocol.ts`):
  ephemeral, no file, evaporates on disconnect. Per keystone 5, **processing
  can never read presence** — so a presence-carried selection can drive
  *editor-side* highlighting but **cannot** reach `process()` to filter.

They're complementary, not competing: **presence** is the right substrate for
ephemeral, editor-only, live highlight (the CLAUDE.md "deferred — build on
presence; a selection is just a `control.event`" note); the **file** is
required the moment the selection must filter a pipeline or be written by the
headless agent. This plan is the file path; a presence-only live-highlight
brush can be built independently and they coexist.

## 5. The brush-linking loop (worked example)

```
  viz A (brush)                         linked node B
  ───────────                           ─────────────
  control.event "brush"                 in: { sel: _brush/selection.json, data: cocoon://Up/out/data }
    → writes _brush/selection.json      watches: { stale: ['sel'] }      ← FILTER variant
    → (optionally) signals the core      process(): reads `sel` as the active filter

                       _brush/selection.json
                              │
              ┌───────────────┴───────────────┐
        core watcher (or explicit signal)      │
              │  looks up the file → nodes that declare it
              ▼
        B (stale: 'sel')  → markStale(B) + downstream   → B goes amber; PULL applies the filter
        C (refresh:'sel') → statePatch(C)                → C re-highlights live; no pull, no stale
```

- **Filter variant** (`stale`): B's `process()` reads the selection as a
  filter; on brush, B + downstream age; the human/agent pulls B to apply.
  Pull-only preserved — the brush sets up the filter, the pull applies it.
  Many nodes declaring `stale: 'sel'` on one file = linked filtering.
- **Highlight variant** (`refresh`): C's `control.data` reads the selection
  and its render highlights the brushed items; on brush, C's control
  re-derives and re-streams — live, no pull, no status change.

The brush itself is just a `control.event` on A (keystone 5). Nothing new
there; the new part is how its file write reaches B and C.

## 6. Declaration syntax

The **kind** (does the file feed `process` or only `control.data`?) is
intrinsic node semantics → it lives in the **module**. The **path** is
per-instance wiring already in `in:` → reference it by **key** (DRY, and the
brush-file path differs per flow). This is the "hybrid" — module-declared kind,
YAML-declared path — and it's the sweet spot.

Add to `CocoonProcessNode` (`core/contract.ts`):

```ts
/**
 * Files this node depends on but has no edge to. The core watches the file
 * named by each `in:` key and reacts on change — never running process()
 * (the invariant). Kind is intrinsic (which half reads the file) so it's
 * here in code; path is wiring so it stays in `in:` and is referenced by key.
 * v1 watches only statically-resolvable string-literal `in:` values.
 */
watches?: {
  /** in: keys whose file feeds process() → markStale(node)+downstream. */
  stale?: string[];
  /** in: keys whose file feeds only control.data → statePatch. */
  refresh?: string[];
};
```

```yaml
# flow
BrushFilter:
  in:
    sel: _brush/selection.json          # literal path → watched
    data: cocoon://Upstream/out/data    # edge (untouched)
  type: BrushFilter
# module BrushFilter.ts:  watches: { stale: ['sel'] }
```

The core resolves each listed key's `in:` value through the existing
`resolvePath` semantics. If a key's value is a `cocoon://` edge or non-literal
(path comes from upstream data), it is **skipped and `log()`-ed** — no silent
truncation (v2 may resolve dynamic paths post-pull). Flat `staleOn:`/
`refreshOn:` arrays are an acceptable alternative spelling; the grouped
`watches` object keeps the kind explicit.

## 7. Visibility (required for `stale`, not for `refresh`)

A `stale`-kind dependency MUST be visible, or the canvas lies (B goes amber
with no on-screen cause).

- **v1 — node badge.** Stream the resolved watched paths in `NodeState`
  (`protocol.ts`), e.g. `watches?: { stale: string[]; refresh: string[] }`
  (resolved paths). The editor renders a small badge on the reader node:
  `⊙ _brush/selection.json`. This directly answers "why did B go amber?" —
  it's on the node that ages.
- **v2 — dashed ambient edge.** If a *writer* also declares it (`writes:
  ['sel']`), the core can pair writer→reader on the same path and the editor
  draws a dashed, non-interactive "ambient edge". Defer until writer
  declaration is justified; the badge is enough for legibility.
- **`refresh`-kind needs no visual** — no status change, pure presentation;
  a badge is optional nicety.

## 8. Trigger hierarchy

Both effects are driven by the **same declared-dependency index** (`file →
[{nodeId, kind}]`). Two ways to fire it; primacy differs by use case, but the
effect and the invariant are identical:

- **Self-write, single node (annotation):** explicit is primary. The writer
  *is* the node; it knows when it wrote. `control.event` auto-statePatches;
  the agent calls `cocoon refresh-control`. The watcher is sugar.
  **Already shipped.**
- **Cross-node ambient dep (brush-linking):** the watcher is primary. The
  dependency is declared on the *reader* (B); the *writer* (A) doesn't know
  its readers, so requiring A to announce every write is brittle. The core
  watches the file on B's behalf and ages B on change. This is genuinely a
  watcher's job — and it stays pull-pure (effect = markStale, never process)
  and legible (§7).
- **Optional explicit fast-path for announce-capable writers:** a
  `ctx.markSharedStale(path)` on `ControlContext` (and/or a thin
  `cocoon stale <node>` CLI verb, symmetric to `refresh-control`) consults the
  same index for immediacy and an in-band audit trail. Not required for
  correctness — the watcher backstops it.

## 9. Core ownership & lifecycle

The node **cannot** own the watcher (no teardown hook; leaks on module
hot-swap, reload, window close — `contract.ts` has no `dispose`). **The core
owns it, at the transport layer, never in `Runtime`** — for the same reason
the flow-file watcher lives in `serve.ts:271` and not `Runtime`: the headless
one-shot `cocoon run` has no clients and must not arm watchers.

- **A `WatchHub`** (new, `core/watch-hub.ts`), constructed in `serve.ts`
  exactly like `PresenceHub` (`serve.ts:229`). It owns the OS handles; it's
  given callbacks into `Runtime` (`markStale`+downstream, `statePatch`-stream)
  and queries `Runtime` for the current watch-set.
- **Keyed by `(nodeId, resolvedPath)`** so it survives module hot-swap (keyed
  by node+path, not the module instance) and diffs cleanly on reload.
- **Mechanism:** reuse `fs.watchFile` (polling a path, not an inode — survives
  an editor's/agent's atomic save-rename, `serve.ts:270`) + the existing
  150ms debounce (`serve.ts:278`). Unwatch all on `wss.close`
  (`serve.ts:281`).
- **Runtime split:** `Runtime` computes the watch-set (it has the file,
  resolver, and resolved `in:` values) and exposes `watchSet():
  {nodeId, path, kind}[]` + an entry point `onWatchedFileChanged(nodeId,
  path)` that applies the effect. `serve.ts`/`WatchHub` owns the handles and
  calls in. Mirrors how `serve.ts` owns the flow watcher but calls
  `rt.reload()`.

## 10. Echo / idempotency

A node that both reads and writes the same file (e.g. an annotation node whose
`merge_done` writes `bgg_annotations.json`, which it also folds) will
self-trigger the watcher. This is **benign by construction**, and we must keep
it so:

- `markStale` early-returns on a non-`done` node (`runtime.ts:601`), so a
  re-fire after the node already aged is a no-op.
- `statePatch` is an idempotent re-render.
- the 150ms debounce coalesces the write burst.

**Invariant to maintain:** any future watcher effect must be idempotent.
State this next to the `WatchHub`.

## 11. Arming the watch-set & reload composition

- **Arming.** The watch-set depends on the module's `watches` declaration,
  which is known only after the type resolves (lazy). For brush-linking we
  want B to age on an external write *even before anyone looks at B*, so
  **eagerly resolve every node type on serve start** purely to read `watches`
  and arm watchers. Resolving is cheap, mtime-cached, and side-effect-free
  (the symmetric-import rule keeps node top-level to `import type` + relative
  paths — no DB connects at import). The one tradeoff: a broken module
  surfaces its load error at startup instead of first-pull; acceptable, and it
  already would on first pull. (Fallback if that tradeoff bites: arm lazily as
  each node resolves through an existing path.)
- **Reload.** On `reload` (`runtime.ts:171`), recompute the desired watch-set
  (re-resolve `watches`, re-resolve paths from the new `in:` values) and
  **diff against active watchers by `(nodeId, path)`**: add new, remove gone,
  keep matching. A changed path-param swaps the watcher. Tie into the existing
  `forgetMissing` cleanup (`runtime.ts:200-201`) for removed nodes. A
  selective reload that preserves a node also preserves its watcher.

## 12. v1 restrictions (explicit, no silent caps)

- Only **statically-resolvable string-literal** `in:` paths are watched;
  edges/computed paths are skipped and `log()`-ed.
- **No `writes:` declaration / no dashed ambient edge** — node badge only.
- **Presence-only live brush** (no file) is out of scope here — it's a
  separate, complementary build on presence.
- The optional `ctx.markSharedStale` / `cocoon stale` explicit fast-path is a
  stretch; the watcher is the v1 mechanism for the cross-node case.

## 13. Implementation phases

1. **Contract + protocol.** Add `watches` to `CocoonProcessNode`
   (`contract.ts`); add the resolved `watches` to `NodeState` (`protocol.ts`)
   for the badge. Write the invariant into both doc-comments.
2. **Runtime watch-set + effect.** `Runtime.watchSet()` (resolve `watches`,
   resolve literal paths, drop non-literals with a `log`), and
   `onWatchedFileChanged(nodeId, path)` → look up kind → `markStale`+downstream
   (stale) or `statePatch`-stream (refresh). Reuse existing `markStale`
   (`runtime.ts:600`) and `renderControls.statePatch`.
3. **WatchHub (transport).** New `core/watch-hub.ts`, constructed in
   `serve.ts`; `fs.watchFile` + 150ms debounce; eager arm on start, diff on
   reload, unwatch on `wss.close`. Calls `rt.onWatchedFileChanged`.
4. **Editor badge.** Render `NodeState.watches` as a node badge; (stretch)
   dashed ambient edge once `writes:` exists.
5. **Optional explicit fast-path.** `ctx.markSharedStale(path)` on
   `ControlContext` + a `cocoon stale <node>` verb (mirror of
   `refresh-control`).

Phases 1–3 deliver headless brush-linking (agent writes the file → linked
nodes age → pull applies); phase 4 makes it legible in the editor.

## 14. Test plan

- **Unit (Runtime):** `watchSet()` resolves literal paths, skips edges with a
  log; `onWatchedFileChanged` ages a `stale`-kind node + downstream and leaves
  a `refresh`-kind node's status untouched while re-streaming `controlData`.
  Assert it **never** calls `process` (the invariant).
- **Integration (serve + WatchHub):** scaffold a temp flow (à la
  `controls.test.ts` / `refresh-control.test.ts`) with a `stale`-kind reader
  and a `refresh`-kind reader sharing one sidecar; write the sidecar
  externally; assert the reader goes `stale` (no pull happened — status is
  `stale`, not `done`) and the highlighter re-streams `controlData` with
  status unchanged.
- **Echo:** a node that reads+writes the same file doesn't thrash (debounce +
  `markStale` done-guard).
- **Reload:** changing the watched path-param swaps the watcher; removing the
  node drops it; `cocoon run` arms **no** watcher.

## 15. Open questions

- **Writer declaration & the dashed edge.** Worth the extra API for a true
  A→B ambient edge, or is the reader badge enough long-term?
- **Eager vs lazy arming** if startup module-import cost or error-timing turns
  out to matter in a large flow.
- **Selection schema.** Standardise a `_brush/selection.json` shape (ids /
  ranges / predicate) so vizzes and filters interoperate, or leave it
  per-flow? Likely per-flow until a second brush pair exists.
- **Coalescing window.** 150ms (the flow-watcher value) vs a brush-specific
  debounce if dragging produces a high-frequency write stream — though a brush
  should write on *commit*, not per-mousemove, which sidesteps this.

## 16. What's already done vs net-new

- **Done:** the `refresh` effect end-to-end — `statePatch`
  (`controls-render.ts:136`), the auto-re-derive on every control event
  (`:182`), and out-of-band triggering via `cocoon refresh-control`
  (`query-client.ts` `sendRefreshControl` + the CLI verb). Annotation
  realtime needs nothing from this plan.
- **Net-new:** the `watches` declaration, `Runtime.watchSet` +
  `onWatchedFileChanged`, the `WatchHub`, the editor badge, and (optional) the
  explicit `stale` fast-path. The `markStale`+downstream cascade itself is
  reused verbatim from the control-event path.
