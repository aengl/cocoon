/**
 * Single reactive resolver for control render hooks. Both surfaces — the
 * inline `CocoonNode` and the detached `ControlWindow` — call this one
 * function; there is deliberately no second path (a previous bug class lived
 * in the gap between two copies).
 *
 * Reading `cache` (a rune `$state`) makes the caller's `$derived` reactive;
 * the first read idempotently kicks the import. The `$state` write lands
 * only in the async `.then` (a microtask, never during derive) — combining
 * a read + write of the same `$state` inside a single derive triggers
 * Svelte 5's self-referential-effect detection and silently aborts.
 */
import { hookFor } from './controlHookLoader';
import type { ControlHook } from './protocol';

let cache = $state<Record<string, ControlHook | undefined>>({});
const inflight = new Set<string>();

export function resolvedHook(
  httpBase: string,
  type: string | undefined,
  mtimeMs: number | undefined
): ControlHook | undefined {
  if (!type || mtimeMs == null) return undefined;
  const key = `${type}@${mtimeMs}`;
  if (!(key in cache) && !inflight.has(key)) {
    inflight.add(key);
    hookFor(httpBase, type, mtimeMs).then(h => {
      cache = { ...cache, [key]: h };
    });
  }
  return cache[key];
}
