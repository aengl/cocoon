/**
 * The **single** reactive control-hook resolver (keystone 2/5). Both
 * surfaces — the inline node (`CocoonNode`) and the detached
 * `ControlWindow` — call this *one* function; there is deliberately no
 * second path. Earlier this logic was duplicated (a bespoke `$effect` in
 * `CocoonNode` + a separate `controlHookCache`/`$effect` in `App`), and
 * every hook bug this session lived in the gap between those two copies.
 * One method, two call sites — exactly "same shim, different element".
 *
 * Resource pattern: reading `cache` (a rune `$state`) makes the *caller's*
 * `$derived` reactive; the first read idempotently kicks the cached
 * `hookFor` import (a non-reactive in-flight guard, never a `$state`
 * read+write in the same scope — that Svelte-5 self-referential-effect trap
 * is what silently disabled the old App effect). The `$state` write lands
 * only in the async `.then` (a microtask, never during derive).
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
