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

/**
 * `absFile -> { mtimeMs, mod }`. **Process-static**: survives both `reset()`
 * AND resolver replacement on `Runtime.reload()`. Node's ESM cache is itself
 * process-wide and keyed by URL, so a fresh resolver importing the bare
 * `file://…` URL would otherwise pick up the prior resolver's stale module
 * — the silent failure behind "hot-swap doesn't pick up edits until I kill
 * the serve". Sharing the mtime cache means the new resolver still knows to
 * append `?m=<mtime>` whenever the file has changed since any prior load.
 */
const sharedModCache = new Map<
  string,
  { mtimeMs: number; mod: Record<string, unknown> }
>();

export class NodeResolver {
  /** `type -> absolute file | null` (null = resolved-as-unknown). */
  private pathCache = new Map<string, string | null>();
  /** Process-static; see `sharedModCache` above. */
  private modCache = sharedModCache;
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

  /** The hot-swap version of the currently-loaded module for `type`: the max
   *  mtime over the entry and its sibling-lib closure (so it advances on a
   *  lib edit too, not just an entry edit). Surfaced to the agent to verify a
   *  node-code edit landed: if `stat(modulePath).mtimeMs` (or any imported
   *  lib) is newer, the next pull re-imports. `undefined` for unknown /
   *  not-yet-resolved types. */
  peekMtime(type: string | undefined): number | undefined {
    if (!type) return undefined;
    const file = this.pathCache.get(type);
    if (!file) return undefined;
    return this.modCache.get(file)?.mtimeMs;
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
    // The hot-reload version token: the max mtime over the entry AND its
    // transitive relative-import closure. A sibling-lib edit bumps this even
    // when the entry file itself is untouched — without it, the entry's URL
    // is unchanged, Node never re-evaluates the entry, and the stale lib is
    // never re-resolved (the "a lib edit needs a serve restart" bug). The
    // `http-import-loader` resolve hook propagates this same `?m=<v>` token
    // down the static-import graph so the changed lib re-evaluates too.
    const version = await closureMtime(file);
    const hit = this.modCache.get(file);
    if (hit && hit.mtimeMs === version) return hit.mod;
    // First-ever import in this process: plain specifier (vitest's transform
    // layer drops the `.ts` classification when a `?m=` query is present and
    // then refuses to strip types). Subsequent re-imports: `?m=<version>`
    // busts Node's URL-keyed ESM cache. `modCache` is process-static so a
    // resolver recreated by `Runtime.reload()` still knows the prior version
    // — without that, the new resolver would hand the same bare URL to Node
    // and pick up the stale cached module.
    const base = pathToFileURL(file).href;
    const url = hit ? `${base}?m=${version}` : base;
    const mod = (await import(url)) as Record<string, unknown>;
    this.modCache.set(file, { mtimeMs: version, mod });
    return mod;
  }
}

/** Static relative (`./`, `../`) specifiers from `import …`/`export … from`
 *  and bare side-effect `import './x'`. npm/CDN deps don't appear: the
 *  symmetric-import rule forces them to runtime `await import()`, so the
 *  static graph is exactly the sibling-lib closure we hot-reload. Dynamic
 *  relative imports are not crawled (rare; they re-resolve at call time). */
const RELATIVE_FROM =
  /(?:^|[\s;}])(?:import|export)\b[^'"`]*?\bfrom\s*['"](\.\.?\/[^'"`]+)['"]/g;
const RELATIVE_BARE = /(?:^|[\s;])import\s*['"](\.\.?\/[^'"`]+)['"]/g;

function relativeImports(src: string): string[] {
  const out = new Set<string>();
  for (const re of [RELATIVE_FROM, RELATIVE_BARE]) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(src)); ) out.add(m[1]);
  }
  return [...out];
}

/** Resolve a relative specifier against `dir`, tolerating the missing-`.ts`
 *  and `/index.*` forms. `null` when nothing on disk matches. */
async function resolveRelative(
  dir: string,
  spec: string
): Promise<string | null> {
  const direct = path.resolve(dir, spec);
  if (await isFile(direct)) return direct;
  for (const e of EXT) if (await isFile(direct + e)) return direct + e;
  for (const idx of INDEX) {
    const f = path.join(direct, idx);
    if (await isFile(f)) return f;
  }
  return null;
}

/** Max mtimeMs over `entry` and its transitive static relative-import
 *  closure. Cheap by design: most nodes import no siblings (one stat + one
 *  read), and unresolvable/already-seen files are skipped. */
async function closureMtime(entry: string): Promise<number> {
  const seen = new Set<string>();
  let max = 0;
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    let src: string;
    try {
      const st = await fs.stat(file);
      if (st.mtimeMs > max) max = st.mtimeMs;
      src = await fs.readFile(file, 'utf8');
    } catch {
      return;
    }
    const dir = path.dirname(file);
    for (const spec of relativeImports(src)) {
      const child = await resolveRelative(dir, spec);
      if (child) await visit(child);
    }
  };
  await visit(entry);
  return max;
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
