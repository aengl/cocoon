# Bug: on-disk node cache ignores module source — edited node code never runs

**Status:** FIXED (2026-05-29). Each persist cache now carries the **module
fingerprint** (max closure mtime over the node's entry + its sibling-lib
closure) it was produced under, embedded in a thin envelope inside the cache
file itself — no sidecar, so it's created/replaced/deleted atomically with the
data. Restore (both `runOne`'s fast-path and the background hydrate) rejects a
cache whose stored fingerprint differs from the module's *current* on-disk
fingerprint and recomputes instead, logging one line. Implementation:
`NodeResolver.currentMtime` (`core/resolve-nodes.ts`), the envelope +
`readCacheFingerprint` (`core/persist-cache.ts`), the guard in
`Hydration.doRestore` (`core/hydration.ts`), and the write/wiring in
`core/runtime.ts`. Regression test: "rejects a cache whose fingerprint predates
the node module" in `src/lib/__tests__/persist-hydrate.test.ts`. The original
report follows.

**Severity:** high (silent staleness — an agent/human edits a node, re-runs it, and
gets the *old* behaviour with no error or warning).
**Component:** core runtime — node output cache (`_cocoon_cache/<Node>.json`) + the
resolver's "hot-swap on mtime" path.
**Found:** 2026-05-29, in the `tibi` repo (`packages/spiele.tips-cocoon`), against a
running `cocoon serve` with the browser editor attached.

## Summary

The core persists each node's output to `_cocoon_cache/<NodeId>.json` and restores it
on `process`. The cache validity check appears keyed on the YAML **compute signature**
(`type` + `in:` + transitive upstream) but **not** on the node **module's source**. So
after editing a node module file, re-processing the node **restores the stale cached
output instead of re-executing the edited module** — reported as
`status: done, summary: "Restored from cache (data: N)"`.

This directly contradicts the documented behaviour in the agent skill
(`SKILL.md`):

> "Node *module code* does not need a reload at all — it is hot-swapped at execution
> time by the resolver when its mtime changes…"
> "`process` the changed node *itself* (the target always recomputes)…"

The module may well be hot-swapped *for execution*, but execution never happens: the
cache short-circuits it. Neither `cocoon reload` + `cocoon process <node> --rerun-stale`
nor a bare `cocoon process <node>` recomputes an edited-but-otherwise-unchanged node.

## Reproduction (minimal)

1. With a `cocoon serve` running and a node `Foo` already processed once (so
   `_cocoon_cache/Foo.json` exists), edit `Foo`'s module to change an observable
   output — e.g. append a sentinel to its return summary:
   ```ts
   return `… [hotreload-probe-v2]`;
   ```
2. `cocoon reload`            # re-parses YAML; does NOT mark Foo stale (YAML unchanged)
3. `cocoon process Foo`       # and/or `cocoon process Foo --rerun-stale`
4. `cocoon query node Foo`    # → summary: "Restored from cache (data: N)" — sentinel ABSENT

**Expected:** step 3 re-executes the edited module; the sentinel appears.
**Actual:** the pre-edit cached output is restored; the sentinel never appears. No
warning that the on-disk module is newer than the cache.

## Proof it's the cache (not the resolver/import)

Moving the cache aside forces a real recompute and the edit takes effect immediately:

```sh
mv _cocoon_cache _cocoon_cache.bak
cocoon process Foo
cocoon query node Foo     # → summary now contains [hotreload-probe-v2]
```

Observed verbatim in the repro:
- before: `summary: Restored from cache (data: 18067)` — edited fields absent
- after cache moved: `summary: imported 18067 rows (…) [hotreload-probe-v2]` — edited
  fields present (a newly-added output column showed up too)

So: module resolution is fine; the **cache key is the problem** — it isn't invalidated
by a module-source change.

## Likely root cause

The cache-hit decision is computed without hashing the node's module source. It should
incorporate the same thing the resolver already tracks for hot-swap: the **newest mtime
(or a content hash) across the node's entry module and everything it imports via
relative `./` paths** (sibling libs). Today a node whose YAML signature and upstream are
unchanged is treated as a cache hit even though its code changed.

Pointers for whoever fixes it:
- Grep the message string `Restored from cache` to find the cache-restore path.
- Cache files live at `<flowdir>/_cocoon_cache/<NodeId>.json`.
- The resolver already knows how to compute "newest mtime across entry + relative
  imports" for hot-swap — reuse that signal as (part of) the cache key / invalidation
  check.

## Suggested fix

Fold a **module-source fingerprint** into the cache key (or the staleness check):
`cacheValid = computeSignatureMatches && moduleFingerprintMatches`, where
`moduleFingerprint` = max mtime (or hash) over the node's entry file and its transitively
`./`-imported siblings. A mismatch should mark the node stale (and bust its cache) just
like a YAML compute-signature change does. Bonus: when restoring from cache, if the
module fingerprint is newer than the cache, log a one-line warning instead of silently
serving stale output.

## Workaround (until fixed)

Delete the specific cache entry before re-processing an edited node:

```sh
rm -f _cocoon_cache/<NodeId>.json
cocoon process <NodeId>
```

(Deleting the whole `_cocoon_cache/` dir works too but forces every node — including
expensive importers — to recompute.)

## Impact in practice

This bit a real change in `tibi`: edits to `ImportGeizhals.ts` (new output column) and
`packages/cocoon/nodes/Join.ts` were both invisible to the running flow until the cache
entry was removed — the node kept serving its pre-edit output and reported `done`, so it
looked like the edit "didn't take" with no clue why. An agent iterating on node code
will hit this constantly and may wrongly conclude its code is wrong.
