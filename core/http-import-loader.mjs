/**
 * Node-side counterpart of the esbuild `httpLoader` plugin. Lets a node
 * `await import('https://…')` inside `process()`/`control.*`.
 *
 * Node 24 dropped `--experimental-network-imports`, so this is a
 * `module.register()` resolve+load hook. Fetched modules are cached at
 * `~/.cache/cocoon/http-imports/<sha256>.mjs` so subsequent runs are
 * offline and instant.
 *
 * Relative imports inside a fetched module are resolved against its URL
 * (defensive — esm.sh `?bundle` is one self-contained ESM, but other CDNs
 * may emit relative deps).
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
  const resolved = await nextResolve(specifier, context);
  // Propagate the resolver's hot-reload version token (`?m=<v>`) down the
  // static-import graph: when a node entry is re-imported as `Entry.ts?m=V`,
  // every sibling lib it (transitively) imports is keyed by the same V, so a
  // changed closure re-evaluates as one unit. Without this the entry's
  // `import './lib'` resolves to the bare, already-cached lib URL and the
  // edit is invisible until a `serve` restart. Scoped to file URLs reached
  // from an already-stamped parent, so core modules are never touched.
  if (context.parentURL && resolved.url.startsWith('file:')) {
    const v = new URL(context.parentURL).searchParams.get('m');
    if (v) {
      const u = new URL(resolved.url);
      if (!u.searchParams.has('m')) {
        u.searchParams.set('m', v);
        return { ...resolved, url: u.href };
      }
    }
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  if (/^https?:\/\//.test(url)) {
    const source = await fetchWithCache(url);
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
