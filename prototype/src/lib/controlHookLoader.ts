/**
 * Editor side of the control-render-code delivery path (keystone 2/5).
 *
 * The core esbuild-bundles a node's co-located `hook` export and serves it at
 * `GET /hook/<type>?m=<mtimeMs>`. Here we dynamic-`import()` that — **no
 * registry**, resolved by convention from the node type, exactly as keystone
 * 6 killed the node registry. The `?m=<mtimeMs>` (streamed in
 * `NodeState.controlHook`) is the browser twin of the resolver's
 * `?m=<mtime>`: a changed file ⇒ a new module URL ⇒ the editor re-imports,
 * same hot-reload as node code.
 */
import type { ControlHook } from './view-contract';

// One in-flight/settled import per `type@mtime`. A new mtime ⇒ new key ⇒
// fresh import; stale entries are harmless (the browser keeps the old URL).
const cache = new Map<string, Promise<ControlHook | undefined>>();

export function hookFor(
  httpBase: string,
  type: string,
  mtimeMs: number
): Promise<ControlHook | undefined> {
  const key = `${type}@${mtimeMs}`;
  let pending = cache.get(key);
  if (!pending) {
    const url = `${httpBase}/hook/${encodeURIComponent(type)}?m=${mtimeMs}`;
    pending = import(/* @vite-ignore */ url)
      .then(m => (m as { hook?: ControlHook }).hook)
      .catch((err: unknown) => {
        // The node still works — it just shows its inert HTML without the
        // hook. Loud so a broken bundle isn't silent.
        console.error(`control hook "${type}" failed to load:`, err);
        return undefined;
      });
    cache.set(key, pending);
  }
  return pending;
}
