/**
 * Project-local custom-node loading. Legacy-faithful: a project declares its
 * own node types in the `package.json` next to the cocoon.yml —
 *
 *   "cocoon": { "nodes": ["nodes/circle.js", "nodes/Wikipedia"] }
 *
 * — each entry a path (extension optional) to a CJS or ESM module whose
 * *named* exports are nodes. The export name *is* the node type, verbatim
 * legacy semantics ("the name of the export determines the name of the node;
 * the filename is irrelevant; one file may export multiple nodes"). One
 * module can therefore contribute several types.
 *
 * Registry-free elsewhere by design, so this is the *one* place project nodes
 * enter the system — merged over the built-in registry, project winning on
 * collision (project intent beats a same-named built-in). Bare npm-*package*
 * specs (no leading `.`/`/`, resolved from node_modules) remain deferred; this
 * handles the project-relative case every example uses.
 *
 * Never throws: no/invalid package.json yields `base` untouched; a module
 * that fails to import (syntax error, missing dependency) is recorded in
 * `errors` and skipped, so only the types it would have provided fail — the
 * rest of the graph still runs. Node strips types from imported `.ts`, so
 * `.ts` custom nodes work the same as the core's own.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CocoonProcessNode, Registry } from './contract.ts';

/** Tried in order; `''` first so an explicit extension in the spec wins. */
const EXT = ['', '.ts', '.js', '.mjs', '.cjs'];
const INDEX = ['index.ts', 'index.js', 'index.mjs', 'index.cjs'];

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Resolve a `cocoon.nodes` spec (relative to the project dir) to a file. */
async function resolveSpec(dir: string, spec: string): Promise<string | null> {
  const base = path.resolve(dir, spec);
  for (const ext of EXT) if (await isFile(base + ext)) return base + ext;
  for (const idx of INDEX) {
    const p = path.join(base, idx);
    if (await isFile(p)) return p;
  }
  return null;
}

const isNode = (v: unknown): v is CocoonProcessNode =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { process?: unknown }).process === 'function';

/**
 * Every named node export of an imported module. Node's CJS↔ESM interop
 * usually lifts `module.exports.Foo` to a `Foo` namespace export (via
 * cjs-module-lexer), but also exposes the whole `module.exports` as
 * `default`; scanning both makes `module.exports.Foo = …` resolve even when
 * the lexer can't see it. `default`/`__esModule` are never node *names*.
 */
function collectNodes(mod: Record<string, unknown>): Registry {
  const found: Registry = {};
  const scan = (obj: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(obj)) {
      if (name === 'default' || name === '__esModule') continue;
      if (isNode(value)) found[name] = value;
    }
  };
  scan(mod);
  const def = (mod as { default?: unknown }).default;
  if (def && typeof def === 'object') scan(def as Record<string, unknown>);
  return found;
}

export interface LoadedNodes {
  registry: Registry;
  /** `spec -> reason` for modules that failed to load (kept non-fatal). */
  errors: Map<string, string>;
}

/** Merge a project's custom nodes onto `base`. See file header for contract. */
export async function loadProjectNodes(
  cocoonFilePath: string,
  base: Registry
): Promise<LoadedNodes> {
  const errors = new Map<string, string>();
  const dir = path.dirname(path.resolve(cocoonFilePath));

  let specs: string[] = [];
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(dir, 'package.json'), 'utf8')
    );
    const list = pkg?.cocoon?.nodes;
    if (Array.isArray(list))
      specs = list.filter((s): s is string => typeof s === 'string');
  } catch {
    return { registry: { ...base }, errors }; // no / invalid package.json
  }

  const registry: Registry = { ...base };
  for (const spec of specs) {
    try {
      const file = await resolveSpec(dir, spec);
      if (!file) throw new Error('module not found');
      const mod = (await import(pathToFileURL(file).href)) as Record<
        string,
        unknown
      >;
      const nodes = collectNodes(mod);
      const names = Object.keys(nodes);
      if (names.length === 0) throw new Error('no node exports found');
      for (const n of names) registry[n] = nodes[n];
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.set(spec, reason);
      console.error(`[cocoon] custom nodes "${spec}" not loaded: ${reason}`);
    }
  }
  return { registry, errors };
}
