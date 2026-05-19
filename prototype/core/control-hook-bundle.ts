/**
 * The control-render-code delivery seam (keystone 2/5 — the LiveView
 * `phx-hook` analogue, the "one disciplined delivery path").
 *
 * A node is **one co-located source file**: `process` + `control.{data,
 * render,event}` (Node-side, loaded by the keystone-6 resolver) **and**
 * `export const hook` (browser-side render code). The core never *evaluates*
 * the hook — the symmetric dynamic-import rule keeps its browser deps out of
 * the Node side. Here we esbuild-bundle just the `hook` export for the
 * browser; esbuild tree-shakes the Node-side exports away; the result is one
 * self-contained ESM string the editor `import()`s.
 *
 * Dependencies: a node declares them **in its own source as pinned CDN URLs**
 * (`import('https://esm.sh/wordcloud@1.2.2?bundle')`) — keystone 6, the node
 * carries its own everything, nothing to install, no `node_modules`. The
 * `httpLoader` plugin fetches & inlines them **at bundle time**, so the
 * served hook stays one self-contained file (internet needed only here, on
 * first bundle of a given mtime; then cached). Trade: a bundle-time network
 * dependency + a supply-chain surface, accepted deliberately and pinned by
 * exact version. The dead legacy monorepo's Yarn PnP manifest is gone, so no
 * resolver-bypass is needed: the only resolutions are the absolute entry
 * file, type-only (elided) imports, and these `https:` URLs.
 *
 * No registry: the hook is found *by convention from the node module*,
 * exactly as keystone 6 killed the node registry. mtime-keyed cache — the
 * browser twin of the resolver's `?m=<mtime>` hot-reload.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

/**
 * Fetch `http(s):` imports at bundle time and inline them (esbuild leaves
 * them external otherwise). The canonical esbuild HTTP-loader recipe: tag
 * URL imports into a namespace, resolve a fetched module's own (possibly
 * relative) sub-imports against its URL, and `onLoad` returns the fetched
 * source. `esm.sh/...?bundle` returns a single self-contained ESM, so in
 * practice this is one fetch; the relative-resolution arm is defensive.
 */
const httpLoader: Plugin = {
  name: 'cocoon-http-import',
  setup(b) {
    b.onResolve({ filter: /^https?:\/\// }, args => ({
      path: args.path,
      namespace: 'http-url',
    }));
    b.onResolve({ filter: /.*/, namespace: 'http-url' }, args => ({
      path: new URL(args.path, args.importer).toString(),
      namespace: 'http-url',
    }));
    b.onLoad({ filter: /.*/, namespace: 'http-url' }, async args => {
      const res = await fetch(args.path);
      if (!res.ok)
        throw new Error(
          `hook dep fetch failed: ${res.status} ${args.path}`
        );
      return { contents: await res.text(), loader: 'js' };
    });
  },
};

const cache = new Map<string, { mtimeMs: number; code: string }>();

/**
 * Bundle `export { hook }` from `absFile` for the browser. Throws if the file
 * has no `hook` export, a CDN dep can't be fetched, or — by design — it
 * statically imports a `node:*` builtin (the symmetric-import rule: Node-only
 * deps stay dynamically imported inside the Node-side halves).
 */
export async function bundleHook(absFile: string): Promise<string> {
  const { mtimeMs } = await stat(absFile);
  const hit = cache.get(absFile);
  if (hit && hit.mtimeMs === mtimeMs) return hit.code;

  const result = await build({
    stdin: {
      // Re-export only `hook`; esbuild tree-shakes the Node-side exports
      // (process/control + their type-only imports) out entirely.
      contents: `export { hook } from ${JSON.stringify(absFile)};`,
      resolveDir: path.dirname(absFile),
      sourcefile: 'cocoon-control-hook-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    sourcemap: 'inline',
    legalComments: 'none',
    logLevel: 'silent',
    plugins: [httpLoader],
  });
  const code = result.outputFiles[0]!.text;
  cache.set(absFile, { mtimeMs, code });
  return code;
}
