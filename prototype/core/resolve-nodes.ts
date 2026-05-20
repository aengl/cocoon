/**
 * Convention-based node resolution — no registry map, no `package.json`.
 *
 * A node `type: X` resolves by filename to `X.{ts,js,mjs,cjs}` (or
 * `X/index.*`) across **two** roots, in NO privileged order:
 *
 *   1. a `nodes/` dir next to the cocoon file,
 *   2. extra dirs the cocoon file declares (its `nodeDirs:` key — a
 *      hand-authored pass-through, for shared node repos like tibi's).
 *
 * **Core ships zero built-in nodes** (since the function-library cut —
 * CLAUDE.md keystone 6). There used to be a third root (`core/nodes/`); it's
 * gone with the moved-to-tibi nodes. Every node a flow uses now lives next
 * to the flow or in a declared `nodeDirs:` repo.
 *
 * Type-name collisions across roots are a **categorical hard error**, never
 * shadowing (override semantics aren't worth the edge cases — keystone 6).
 *
 * Loading is **pull-triggered, execution-time, mtime-keyed**: `resolve()`
 * runs when a node runs; the module is re-imported only when its file mtime
 * changed (a `?m=<mtime>` specifier — Node's ESM cache is URL-keyed, so the
 * *key* busts it; re-calling `import()` alone would not). That IS keystone-6
 * hot reload, but pull-triggered, not watcher-triggered. Per-module
 * isolation is automatic + lazy: a broken/unknown module fails only its own
 * node, only when that node is pulled; unused nodes are never loaded.
 *
 * The export picked from a resolved module is the one named after the type,
 * else `default`, else a sole node export (covers `export const Foo` in
 * `Foo.ts` and CJS `module.exports.Foo`).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CocoonProcessNode, Registry } from './contract.ts';

/** Order is search order; first-with-extension wins *within* a root only. */
const EXT = ['.ts', '.js', '.mjs', '.cjs'];
const INDEX = EXT.map(e => `index${e}`);

const isNode = (v: unknown): v is CocoonProcessNode =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { process?: unknown }).process === 'function';

export interface ResolveResult {
  node?: CocoonProcessNode;
  /** Human-readable reason when `node` is absent (unknown / collision / failed import). */
  error?: string;
}

export class NodeResolver {
  /** `type -> absolute file | null` (null = resolved-as-unknown). Cleared by `reset()`. */
  private pathCache = new Map<string, string | null>();
  /** `absFile -> { mtimeMs, mod }`. Survives reset; mtime is the freshness key. */
  private modCache = new Map<
    string,
    { mtimeMs: number; mod: Record<string, unknown> }
  >();
  private readonly roots: string[];
  /** Programmatic / test seam: in-memory nodes, NOT a file root, no collision check. */
  private readonly overrides: Registry;

  constructor(opts: {
    cocoonFilePath: string;
    /** Extra node dirs declared by the cocoon file, relative to it. */
    nodeDirs?: string[];
    overrides?: Registry;
  }) {
    const cocoonDir = path.dirname(path.resolve(opts.cocoonFilePath));
    // `~/…` in a declared `nodeDirs:` expands to `$HOME/…` — same idiom as
    // `ctx.resolvePath` and the legacy Download node. Lets a sandbox point
    // at `~/tibi-old/.../nodes` without a brittle relative path or an
    // aen-specific absolute one.
    const expandHome = (d: string) =>
      d.startsWith('~') ? path.join(process.env.HOME ?? '', d.slice(1)) : d;
    const declared = (opts.nodeDirs ?? []).map(d =>
      path.resolve(cocoonDir, expandHome(d))
    );
    this.roots = [path.join(cocoonDir, 'nodes'), ...declared];
    this.overrides = opts.overrides ?? {};
  }

  /** Drop the path cache so newly-added files / changed node-dirs are seen. */
  reset() {
    this.pathCache.clear();
  }

  /**
   * Already-loaded node for a type, or `undefined` — synchronous, for the
   * persist-default peek. A persist-by-default custom node's default only
   * takes effect once it has been resolved at least once (no built-in sets
   * one, so this is unobservable for them).
   */
  peek(type: string | undefined): CocoonProcessNode | undefined {
    if (!type) return undefined;
    if (this.overrides[type]) return this.overrides[type];
    const file = this.pathCache.get(type);
    if (!file) return undefined;
    const hit = this.modCache.get(file);
    return hit ? pickNode(hit.mod, type) : undefined;
  }

  /**
   * Absolute file backing a *resolved* type (post-`resolve`, cache-based —
   * same lazy semantics as `peek`). The delivery seam esbuild-bundles this
   * file's browser `hook` export. `undefined` for built-in/override/unknown.
   */
  peekFile(type: string | undefined): string | undefined {
    if (!type) return undefined;
    return this.pathCache.get(type) ?? undefined;
  }

  /**
   * The file's mtime **iff its loaded module exports a browser `hook`**
   * (keystone 2/5). Streamed in `NodeState.controlHook` so the editor's
   * dynamic `import()` is mtime-busted exactly like the keystone-6 server
   * `?m=<mtime>` — the same hot-reload, the browser twin. `undefined` ⇒ no
   * hook (or not yet resolved).
   */
  peekHookMtime(type: string | undefined): number | undefined {
    if (!type) return undefined;
    const file = this.pathCache.get(type);
    if (!file) return undefined;
    const hit = this.modCache.get(file);
    return hit && hit.mod.hook ? hit.mtimeMs : undefined;
  }

  async resolve(type: string | undefined): Promise<ResolveResult> {
    if (!type) return { error: `Unknown node type "${type}"` };
    if (this.overrides[type]) return { node: this.overrides[type] };

    let file = this.pathCache.get(type);
    if (file === undefined) {
      const hits: string[] = [];
      for (const root of this.roots) {
        const f = await locate(root, type);
        if (f) hits.push(f);
      }
      if (hits.length > 1)
        // Not cached: a fix (delete one) should be seen on the next resolve.
        return {
          error: `Node type "${type}" defined in multiple locations: ${hits.join(
            ', '
          )} — type-name collisions are not allowed`,
        };
      file = hits[0] ?? null;
      this.pathCache.set(type, file);
    }
    if (file == null) return { error: `Unknown node type "${type}"` };

    try {
      const mod = await this.loadModule(file);
      const node = pickNode(mod, type);
      if (!node)
        return {
          error: `Node type "${type}" failed to load (${path.basename(
            file
          )}: no node export found)`,
        };
      return { node };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        error: `Node type "${type}" failed to load (${path.basename(
          file
        )}: ${reason})`,
      };
    }
  }

  private async loadModule(file: string): Promise<Record<string, unknown>> {
    const { mtimeMs } = await fs.stat(file);
    const hit = this.modCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.mod;
    // First import of this file in the process needs no cache-bust (nothing
    // is cached yet) — a plain specifier, which every loader (incl. vitest's
    // transform) accepts. Only a *re-import* of an already-loaded, changed
    // module must bust the URL-keyed ESM cache, via `?m=<mtime>` (the only
    // path the query takes; it's a long-lived `serve` hot-reload, run under
    // plain Node, where the queried specifier works).
    const base = pathToFileURL(file).href;
    const url = hit ? `${base}?m=${mtimeMs}` : base;
    const mod = (await import(url)) as Record<string, unknown>;
    this.modCache.set(file, { mtimeMs, mod });
    return mod;
  }
}

async function locate(root: string, type: string): Promise<string | null> {
  for (const e of EXT) {
    const f = path.join(root, type + e);
    if (await isFile(f)) return f;
  }
  for (const idx of INDEX) {
    const f = path.join(root, type, idx);
    if (await isFile(f)) return f;
  }
  return null;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * The node export matching `type`, else `default`, else a sole node export.
 * Node's CJS interop usually lifts `module.exports.Foo` to a `Foo` namespace
 * export, but also exposes the whole `module.exports` as `default`; scanning
 * both makes `module.exports.Foo = …` resolve even when the lexer can't.
 */
function pickNode(
  mod: Record<string, unknown>,
  type: string
): CocoonProcessNode | undefined {
  if (isNode(mod[type])) return mod[type] as CocoonProcessNode;
  const def = (mod as { default?: unknown }).default;
  if (isNode(def)) return def as CocoonProcessNode;
  if (def && typeof def === 'object') {
    const d = def as Record<string, unknown>;
    if (isNode(d[type])) return d[type] as CocoonProcessNode;
  }
  const scan = (o: Record<string, unknown>) =>
    Object.entries(o)
      .filter(([k]) => k !== 'default' && k !== '__esModule')
      .filter(([, v]) => isNode(v))
      .map(([, v]) => v as CocoonProcessNode);
  let hits = scan(mod);
  if (hits.length === 0 && def && typeof def === 'object')
    hits = scan(def as Record<string, unknown>);
  return hits.length === 1 ? hits[0] : undefined;
}
