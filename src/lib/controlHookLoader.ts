/**
 * Editor side of the control-hook delivery seam.
 *
 * The core esbuild-bundles a node's `hook` export and serves it at
 * `GET /hook/<type>?m=<mtimeMs>`. The `mtime` query string is the cache-bust
 * token: a changed file ⇒ a new URL ⇒ a fresh import, same hot-reload
 * discipline as the Node-side resolver.
 */
import type { ControlHook } from './protocol';

// One in-flight/settled import per `type@mtime`. A new mtime ⇒ new key ⇒
// fresh import; stale entries are harmless.
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
