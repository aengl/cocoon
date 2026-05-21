/**
 * Node-side counterpart of the esbuild `httpLoader` plugin in
 * `control-hook-bundle.ts`. Lets a custom node `await import('https://…')`
 * **inside `process()`/`control.*`** — the keystone-6 "node carries its own
 * everything, no `node_modules`" story, applied to the Node side.
 *
 * Node 24 dropped `--experimental-network-imports`; this is the supported
 * route (a `module.register()`-loaded resolve+load hook). Fetched modules are
 * cached on disk (`~/.cache/cocoon/http-imports/<sha256>.mjs`) so subsequent
 * runs are offline + instant, mirroring esbuild's bundle-time cache.
 *
 * Relative imports inside a fetched module are resolved against its URL
 * (defensive — esm.sh `?bundle` returns one self-contained ESM, but other
 * CDNs may emit relative deps). Sub-URL fetches are recursive through the
 * same load hook.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = join(homedir(), '.cache', 'cocoon', 'http-imports');
mkdirSync(CACHE_DIR, { recursive: true });

const memCache = new Map();

function cachePath(url) {
  const h = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return join(CACHE_DIR, `${h}.mjs`);
}

async function fetchWithCache(url) {
  if (memCache.has(url)) return memCache.get(url);
  const file = cachePath(url);
  if (existsSync(file)) {
    const src = readFileSync(file, 'utf8');
    memCache.set(url, src);
    return src;
  }
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`cocoon http-import: ${res.status} ${res.statusText} ${url}`);
  const src = await res.text();
  writeFileSync(file, src);
  memCache.set(url, src);
  return src;
}

export async function resolve(specifier, context, nextResolve) {
  if (/^https?:\/\//.test(specifier)) {
    return { url: specifier, shortCircuit: true, format: 'module' };
  }
  // A fetched module re-importing a relative path resolves against its URL.
  if (context.parentURL && /^https?:\/\//.test(context.parentURL)) {
    if (!/^[a-z]+:/i.test(specifier)) {
      const url = new URL(specifier, context.parentURL).toString();
      return { url, shortCircuit: true, format: 'module' };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/^https?:\/\//.test(url)) {
    const source = await fetchWithCache(url);
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
