/**
 * Control-render code delivery seam. A node is one co-located source file
 * with both Node-side (`process` + `control.{data,render,event}`) and
 * browser-side (`export const hook`) exports. Here we esbuild-bundle just
 * the `hook` for the browser; tree-shaking drops the Node-side exports;
 * the result is one self-contained ESM string the editor `import()`s.
 *
 * Dependencies are declared by the node as pinned CDN URLs (e.g.
 * `import('https://esm.sh/wordcloud@1.2.2?bundle')`). The `httpLoader`
 * plugin fetches and inlines them at bundle time, so the served hook is
 * self-contained. mtime-keyed cache.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

/**
 * Fetch `http(s):` imports at bundle time and inline them. Tag URL imports
 * into a namespace, resolve a fetched module's relative sub-imports against
 * its URL, return the fetched source from `onLoad`. `esm.sh?bundle` returns
 * one self-contained ESM, so usually one fetch; the relative arm is
 * defensive.
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
 * Bundle `export { hook }` from `absFile` for the browser. Throws on no
 * `hook` export, an unfetchable CDN dep, or a static `node:*` import (the
 * symmetric-import rule: Node-only deps stay dynamically imported).
 */
export async function bundleHook(absFile: string): Promise<string> {
  const { mtimeMs } = await stat(absFile);
  const hit = cache.get(absFile);
  if (hit && hit.mtimeMs === mtimeMs) return hit.code;

  const result = await build({
    stdin: {
      // Re-export only `hook`; tree-shaking drops process/control and
      // their type-only imports entirely.
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
    // Safety net for the symmetric-import rule: every bare specifier stays
    // a literal import in the emitted bundle, never resolved to
    // node_modules. An accidental top-level static `import 'pg'` inside a
    // hook becomes a clean runtime failure in the browser, not a
    // bundle-time crash. Browser deps come via the `httpLoader` above.
    packages: 'external',
    plugins: [httpLoader],
  });
  const code = result.outputFiles[0]!.text;
  cache.set(absFile, { mtimeMs, code });
  return code;
}
