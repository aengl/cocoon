/**
 * Convention-based node resolution. `type: X` resolves to `X.{ts,js,mjs,cjs}`
 * (or `X/index.*`) across two roots in no privileged order:
 *
 *   1. `nodes/` next to the cocoon file
 *   2. dirs declared in the file's `nodeDirs:` key (`~/…` allowed)
 *
 * Type-name collisions across roots are a hard error, never shadowing.
 *
 * Loading is pull-triggered, mtime-keyed: `resolve()` re-imports only when
 * the file's mtime changed, using a `?m=<mtime>` specifier to bust Node's
 * URL-keyed ESM cache. Broken/unknown modules fail only their own node,
 * only when pulled; unused nodes are never loaded.
 *
 * Export picked: the one named after the type, else `default`, else a sole
 * node export. Covers `export const Foo` and CJS `module.exports.Foo`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CocoonProcessNode, Registry } from './contract.ts';

/** Search order; first-with-extension wins WITHIN a root only. */
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
  /** `type -> absolute file | null` (null = resolved-as-unknown). */
  private pathCache = new Map<string, string | null>();
  /** `absFile -> { mtimeMs, mod }`. Survives `reset()`; mtime is freshness. */
  private modCache = new Map<
    string,
    { mtimeMs: number; mod: Record<string, unknown> }
  >();
  private readonly roots: string[];
  /** Test seam: in-memory nodes, not a file root, no collision check. */
  private readonly overrides: Registry;

  constructor(opts: {
    cocoonFilePath: string;
    /** Extra node dirs, relative to the cocoon file; `~/…` allowed. */
    nodeDirs?: string[];
    overrides?: Registry;
  }) {
    const cocoonDir = path.dirname(path.resolve(opts.cocoonFilePath));
    const expandHome = (d: string) =>
      d.startsWith('~') ? path.join(process.env.HOME ?? '', d.slice(1)) : d;
    const declared = (opts.nodeDirs ?? []).map(d =>
      path.resolve(cocoonDir, expandHome(d))
    );
    this.roots = [path.join(cocoonDir, 'nodes'), ...declared];
    this.overrides = opts.overrides ?? {};
  }

  /** Drop the path cache so newly-added files / changed dirs are seen. */
  reset() {
    this.pathCache.clear();
  }

  /** Synchronous lookup of an already-resolved type. Returns `undefined`
   *  before the type has been `resolve`d at least once. */
  peek(type: string | undefined): CocoonProcessNode | undefined {
    if (!type) return undefined;
    if (this.overrides[type]) return this.overrides[type];
    const file = this.pathCache.get(type);
    if (!file) return undefined;
    const hit = this.modCache.get(file);
    return hit ? pickNode(hit.mod, type) : undefined;
  }

  /** Absolute file backing a resolved type. `undefined` for unknown,
   *  override, or not-yet-resolved types. */
  peekFile(type: string | undefined): string | undefined {
    if (!type) return undefined;
    return this.pathCache.get(type) ?? undefined;
  }

  /** The file's mtime IFF its loaded module exports a browser `hook`. Used
   *  by the editor to mtime-bust its dynamic `import()`. `undefined`
   *  otherwise (no hook, or not yet resolved). */
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
        // Not cached: a fix (delete one) is seen on the next resolve.
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
    // First import: plain specifier (vitest's transform layer accepts it).
    // Re-import of a changed module: `?m=<mtime>` busts the URL-keyed ESM
    // cache (the long-lived `serve` hot-reload path under plain Node).
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
 * Pick the node export. Order: named `type`, then `default`, then a sole
 * node export. Scans both `mod` and `mod.default` because Node's CJS interop
 * exposes `module.exports` as `default` (sometimes the only place
 * `module.exports.Foo` shows up if the lexer missed it).
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
