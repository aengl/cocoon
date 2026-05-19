/**
 * The processing engine. Transport-agnostic and browser-free by design: the
 * CLI uses it headless, the WebSocket server wraps it for the editor, and an
 * AI/text frontend can drive it the same way. It owns ALL port data; clients
 * only ever receive node *state* (status / summary / per-port counts), never
 * bulk data — that's the whole point of the split.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  extractEdges,
  type CocoonEdge,
  type CocoonFile,
} from '../src/lib/cocoon-file.ts';
import { parseCocoonUri } from '../src/lib/cocoon-uri.ts';
import type { ControlContext, ProcessContext, Progress } from './contract.ts';
import type { ControlSchema, NodeState } from '../src/lib/protocol.ts';
import { digest, peekData, type PeekOptions } from './introspect.ts';
import { loadFlowEnv } from './load-env.ts';
import { guardNodeRun } from './node-guard.ts';
import { readPersistedCache, writePersistedCache } from './persist-cache.ts';
import { NodeResolver } from './resolve-nodes.ts';

const itemCount = (v: unknown) =>
  Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1;

/**
 * The value a steering control takes when no runtime override is set — its
 * declared `default`, else the kind's natural zero (so a node always reads a
 * sane value even before the editor/agent has touched the knob).
 */
function controlDefault(c: ControlSchema): unknown {
  switch (c.kind) {
    case 'toggle':
      return c.default ?? false;
    case 'select':
      return c.default ?? c.options[0];
    case 'text':
      return c.default ?? '';
    case 'number':
      return c.default ?? c.min ?? 0;
  }
}

/**
 * Whether `v` is an acceptable value for control `c`. `setControl` is
 * fire-and-forget (the `setPersist` twin); an invalid write is silently
 * ignored rather than surfaced, so a bad agent/editor value can never corrupt
 * what `process()` reads.
 */
function controlValid(c: ControlSchema, v: unknown): boolean {
  switch (c.kind) {
    case 'toggle':
      return typeof v === 'boolean';
    case 'select':
      return typeof v === 'string' && c.options.includes(v);
    case 'text':
      return typeof v === 'string';
    case 'number':
      return (
        typeof v === 'number' &&
        Number.isFinite(v) &&
        (c.min === undefined || v >= c.min) &&
        (c.max === undefined || v <= c.max)
      );
  }
}

/**
 * Extra node directories the cocoon file declares — an unknown top-level
 * pass-through key (`nodeDirs:`), hand-authored like `env:` and never
 * written by the editor (lossless contract). Resolved relative to the file.
 */
function nodeDirsOf(file: CocoonFile): string[] {
  const v = (file as { nodeDirs?: unknown }).nodeDirs;
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string')
    : [];
}

/**
 * Deterministic structural key: object keys sorted recursively, **array
 * order preserved** (a multi-edge `in:` list concatenates in order — order
 * is semantic). Only ever used to compare two parsed defs across a reload;
 * never serialised or sent anywhere.
 */
function stableKey(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val as Record<string, unknown>)
            .sort()
            .map(k => [k, (val as Record<string, unknown>)[k]])
        )
      : val
  );
}

/**
 * A node's **compute signature** — everything in its YAML def that can
 * change what `process()` produces: `type`, every `in:` entry (literal
 * config *and* edge wiring — a rewire changes the inputs), and static `out:`
 * seeds. Excluded *by design*, so editing them never costs computed state:
 * `editor` (position/actions), `?`/`description` (docs), any unknown
 * pass-through key, and `persist` (disk caching, not the result).
 * Steering/free-form control overlays are runtime
 * state, not YAML, and survive a reload independently — also not a factor.
 */
function computeSig(
  def: { type?: unknown; in?: unknown; out?: unknown } | undefined
): string {
  return def
    ? stableKey({ type: def.type, in: def.in ?? null, out: def.out ?? null })
    : '∅';
}

export type StateListener = (id: string, state: NodeState) => void;

export class Runtime {
  readonly filePath: string;
  yaml: string;
  file!: CocoonFile;
  edges: CocoonEdge[] = [];

  /** Convention node resolver (no registry map; lazy, mtime hot-reload). */
  private resolver!: NodeResolver;
  /** `${nodeId}/${port}` -> data. The single source of truth for port data. */
  private store = new Map<string, unknown>();
  private states = new Map<string, NodeState>();
  private listeners = new Set<StateListener>();
  /** Live persist toggles from the editor. Never written back to YAML. */
  private persistOverride = new Map<string, boolean>();
  /**
   * Live steering-control values (keystone 5) — the `persistOverride` twin:
   * `nodeId -> { controlKey: value }`, a session overlay over the schema
   * defaults, never written to YAML, reset on restart. The *schema* is
   * code-declared (resolved lazily, like everything in keystone 6); only the
   * *value* lives here.
   */
  private controlOverride = new Map<string, Record<string, unknown>>();
  /**
   * Free-form control state (keystone 5 action tier) — an *opaque*,
   * node-owned, ephemeral blob per node. The runtime only holds and streams
   * it; the node's `control.render`/`event` are the only things that read or
   * shape it. Never interpreted by the core, never written to YAML, reset on
   * restart (the `controlOverride` twin, but untyped — see contract.ts).
   */
  private controlBlob = new Map<string, Record<string, unknown>>();
  /** Node *types* whose module failed to import (`type -> reason`), filled
   *  lazily on first resolve so the AI digest can still surface them. */
  private nodeLoadErrors = new Map<string, string>();
  /** Background persist-cache hydration; the core never blocks on it. */
  private hydration: Promise<void> = Promise.resolve();
  /**
   * Bumped on every `reload()`. A background hydration started under an old
   * generation must not write a restored result into a store a newer reload
   * has already cleared.
   */
  private generation = 0;
  /**
   * De-dupes concurrent restores of one node: a background `hydrate()` and a
   * `runOne()` serve-from-cache can both want the same node — a 542 MiB cache
   * must never be stream-parsed twice at once. Keyed by node id.
   */
  private restoreInFlight = new Map<string, Promise<boolean>>();
  /**
   * Serialises `process()`. The editor fires process messages
   * fire-and-forget (serve.ts), so clicking several nodes in quick
   * succession would otherwise run overlapping plans against one shared
   * store: a slow persisted upstream (`ImportBGGData`, ~153k rows) is still
   * `running` when the next plan starts, gets re-run concurrently, and the
   * late-finishing duplicate's `markStale(downstream)` ages a sibling that
   * had already completed from the *same* data. One plan at a time — the
   * "queued" semantics the UI already advertises.
   */
  private processChain: Promise<void> = Promise.resolve();

  private constructor(filePath: string, yaml: string) {
    this.filePath = filePath;
    this.yaml = yaml;
  }

  static async load(filePath: string) {
    const abs = path.resolve(filePath);
    const yaml = await fs.readFile(abs, 'utf8');
    const rt = new Runtime(abs, yaml);
    rt.file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!rt.file.nodes) rt.file.nodes = {};
    // Lazy + registry-free: no node module is loaded here. Each resolves
    // (and hot-reloads by mtime) when its node first runs.
    rt.resolver = new NodeResolver({
      cocoonFilePath: abs,
      nodeDirs: nodeDirsOf(rt.file),
    });
    loadFlowEnv(abs, rt.file.env);
    rt.edges = extractEdges(rt.file);
    rt.resetStates();
    // NB: persisted nodes are NOT hydrated here. Streaming a single cache
    // (ImportBGGData ≈ 542 MiB) takes real time; doing it inside `load()`
    // froze the whole core — `serve()` only opens its socket *after* `load()`
    // resolves. Hydration is now a background task the long-lived frontend
    // starts (see `hydrate()`); the headless one-shot skips it entirely.
    return rt;
  }

  /** All `idle`, ports empty, effective-persist recomputed. */
  private resetStates() {
    this.states.clear();
    for (const id of Object.keys(this.file.nodes))
      this.states.set(id, {
        status: 'idle',
        ports: {},
        persist: this.persistEnabled(id),
      });
  }

  /** Custom-node modules that failed to import (`spec -> reason`). */
  get loadErrors(): ReadonlyMap<string, string> {
    return this.nodeLoadErrors;
  }

  /**
   * Re-read the YAML after the flow was edited on disk (the file watcher, or
   * an explicit `cocoon reload`). **Selective, not a full reset** (it once
   * was — that was fine when reload was a rare explicit action; the watcher
   * makes it per-save, so wiping every computed result on every keystroke is
   * no longer acceptable): each node keeps its result iff its own compute
   * signature *and* entire transitive upstream are unchanged — the structural
   * delta is treated exactly as the pull graph treats an upstream re-run
   * (unchanged-but-fed-by-a-change → `stale`, kept visible; changed → reset).
   * See `applyReloadDiff`. A `nodeDirs`/`env` change can shift resolution for
   * *every* node, so that falls back to the proven full reset. A background
   * `hydrate()` then streams still-persisted nodes back from disk cache.
   * Custom-node modules are re-imported (a just-authored/fixed node is picked
   * up). Per-node `persist`/control session overrides survive for nodes that
   * still exist (file-independent, like persist); orphans are dropped.
   */
  async reload() {
    // Read + parse into locals BEFORE mutating anything. A reload can race a
    // save (the file watcher fires mid-write, or a manual `reload` lands
    // between an editor's write syscalls), so `parse()` may throw on a
    // half-written file — and a failed reload must be a complete no-op, never
    // a half-applied state (`this.yaml` swapped to broken bytes while
    // `this.file` stays old, which a freshly-connecting client would then be
    // handed). The manual path always shared this latent race; the watcher
    // just makes it routine, so the fix lives here, not in the trigger.
    const yaml = await fs.readFile(this.filePath, 'utf8');
    const file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!file.nodes) file.nodes = {};
    // Capture the old file BEFORE committing — `applyReloadDiff` diffs it
    // against the new one to decide what state survives. A `nodeDirs`/`env`
    // change can alter module resolution / the environment for every node, so
    // per-node diffing is no longer sound there: fall back to the full reset.
    const oldFile = this.file;
    const globalReset =
      stableKey(nodeDirsOf(oldFile)) !== stableKey(nodeDirsOf(file)) ||
      stableKey(oldFile.env) !== stableKey(file.env);

    // Past the throw point — commit. Supersede any still-running background
    // hydration from the previous load: its captured generation is now stale,
    // so a late-finishing parse won't resurrect a node into a store this
    // reload may have changed under it.
    this.generation++;
    this.yaml = yaml;
    this.file = file;
    // Fresh resolver: re-reads `nodeDirs` and drops the path cache so a
    // just-added node file / changed node-dir is picked up. Module *code*
    // is mtime-hot-reloaded by the resolver itself at execution time.
    this.resolver = new NodeResolver({
      cocoonFilePath: this.filePath,
      nodeDirs: nodeDirsOf(this.file),
    });
    this.nodeLoadErrors.clear();
    loadFlowEnv(this.filePath, this.file.env);
    this.edges = extractEdges(this.file);
    // Session overrides are file-independent, so they survive a reload for
    // nodes that still exist (exactly like persist); drop only the orphans.
    for (const id of [...this.persistOverride.keys()])
      if (!this.file.nodes[id]) this.persistOverride.delete(id);
    for (const id of [...this.controlOverride.keys()])
      if (!this.file.nodes[id]) this.controlOverride.delete(id);
    for (const id of [...this.controlBlob.keys()])
      if (!this.file.nodes[id]) this.controlBlob.delete(id);

    if (globalReset) {
      this.store.clear();
      this.resetStates();
    } else {
      await this.applyReloadDiff(oldFile);
    }
    // Re-light still-persisted nodes from disk in the background: each streams
    // to `done` (and re-broadcasts to the listening editor) as its cache
    // finishes. Skips nodes the diff kept `done`/`stale` (not `idle`), so a
    // preserved 542 MiB result is never needlessly re-read. Not awaited — a
    // big cache must not freeze the "fix it, watch it light up" loop.
    void this.hydrate();
  }

  /**
   * Selective reload (keystone-6 refinement). Keep the computed result of
   * every node whose **own compute signature AND entire transitive upstream**
   * are unchanged; treat the structural delta exactly as the pull graph
   * already treats an upstream re-run:
   *
   *  - self unchanged + all upstream unchanged → **preserved** (`done`/`stale`
   *    + output kept; the control payload is re-derived lazily on the next
   *    pull/event, never recomputed here);
   *  - self unchanged but some upstream moved → **`stale`** if it had a
   *    `done`/`stale` result (kept visible, amber; persist cache dropped — a
   *    `stale` node must not be memoised), else reset;
   *  - own def changed, or a brand-new node → **reset** to `idle`. Its
   *    persist cache is dropped too: it was written by the *old* definition
   *    and `hydrate()` restores at load, so a survivor would silently serve
   *    stale-def data as `done` (the exact `markStale` rider);
   *  - removed node → purged (store + state).
   *
   * Conservative by construction and that **is** the safety argument: a
   * false *reset* only costs a re-pull; a false *preserve* would show stale
   * data as fresh. Anything not provably unchanged is reset, and the only
   * thing ever kept green is a node proven identical down to every root.
   */
  private async applyReloadDiff(oldFile: CocoonFile) {
    const oldNodes = oldFile.nodes ?? {};
    const newNodes = this.file.nodes;
    const sigOld = new Map<string, string>();
    for (const [id, d] of Object.entries(oldNodes)) sigOld.set(id, computeSig(d));

    const selfChanged = (id: string) =>
      !(id in oldNodes) || computeSig(newNodes[id]) !== sigOld.get(id);

    // Transitive: a node holds only if it *and* every node feeding it hold.
    const memo = new Map<string, boolean>();
    const preservable = (id: string): boolean => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      memo.set(id, false); // cycle guard (a DAG, but never loop on a bad file)
      let ok = id in oldNodes && !selfChanged(id);
      if (ok)
        for (const e of this.edges)
          if (e.to === id && !preservable(e.from)) {
            ok = false;
            break;
          }
      memo.set(id, ok);
      return ok;
    };

    const dropStore = (id: string) => {
      for (const k of [...this.store.keys()])
        if (k.startsWith(`${id}/`)) this.store.delete(k);
    };
    const cacheToDrop = new Set<string>();

    // Removed nodes: gone entirely (store + state + any in-flight restore).
    for (const id of Object.keys(oldNodes))
      if (!(id in newNodes)) {
        dropStore(id);
        this.states.delete(id);
        this.restoreInFlight.delete(id);
      }

    for (const id of Object.keys(newNodes)) {
      const prior = this.states.get(id);
      const idle: NodeState = {
        status: 'idle',
        ports: {},
        persist: this.persistEnabled(id),
      };
      const kept = prior?.status === 'done' || prior?.status === 'stale';

      if (selfChanged(id)) {
        // New node, or its own definition moved: any prior output came from a
        // different node. Drop it — and its now stale-def persist cache, or
        // hydrate() would restore outdated data as `done`.
        dropStore(id);
        if (id in oldNodes) cacheToDrop.add(id);
        this.states.set(id, idle);
      } else if (preservable(id)) {
        // Self + entire upstream unchanged — the result still holds.
        if (prior && kept) {
          this.states.set(id, { ...prior, persist: idle.persist });
        } else this.states.set(id, idle);
      } else if (prior && kept) {
        // Self unchanged, an input moved: "was valid, not recomputed" — the
        // pull graph's own `stale`. Keep the output visible; drop the
        // persist cache (a `stale` node must not be memoised).
        if (this.persistEnabled(id)) cacheToDrop.add(id);
        this.states.set(id, { ...prior, status: 'stale', persist: idle.persist });
      } else {
        // Self unchanged but nothing valid to keep (was idle/error/running).
        dropStore(id);
        cacheToDrop.add(id);
        this.states.set(id, idle);
      }
    }

    // Caches must be gone BEFORE the background hydrate() runs, or a reset
    // persisted node (now `idle`) would be restored from its outdated cache.
    await Promise.all(
      [...cacheToDrop].map(id =>
        fs.rm(this.cachePath(id)).catch(() => {
          /* no cache file — fine */
        })
      )
    );
  }

  /**
   * Stream persisted nodes back to `done` from their on-disk cache, in the
   * background; returns the in-flight hydration promise. Idempotent: a call
   * while one is running joins it. Deliberately **not** awaited by `load()` —
   * legacy Cocoon brought the editor up immediately and let persisted nodes
   * "stream in" as their caches restored; a single cache (ImportBGGData
   * ≈ 542 MiB / 153k rows) takes real time to parse and must never freeze the
   * core/editor while it does. The long-lived frontend (`serve`) kicks this
   * off after wiring its state listener so the editor sees each node light
   * up; the headless one-shot `run` skips it (its `runOne` fast-path restores
   * only the caches on the target's path). Tests/embedders that need a
   * fully-hydrated runtime `await` the returned promise (or `whenHydrated()`).
   */
  hydrate(): Promise<void> {
    this.hydration = this.hydratePersisted(this.generation);
    return this.hydration;
  }

  /** Resolves when the current background hydration (if any) has finished. */
  whenHydrated(): Promise<void> {
    return this.hydration;
  }

  /**
   * Summarise a port's data (`cocoon://id/out/port`) without ever returning
   * it raw — the core owns all port data. Bounded by construction; output
   * size tracks schema width + `limit`, not row count. See introspect.ts.
   */
  peek(uri: string, opts: PeekOptions = {}) {
    const parsed = parseCocoonUri(uri);
    if (!parsed) throw new Error(`Not a cocoon:// uri: ${uri}`);
    const key = `${parsed.id}/${parsed.port.name}`;
    if (!this.file.nodes[parsed.id])
      throw new Error(`No such node "${parsed.id}"`);
    return { uri, ...peekData(this.store.get(key), opts) };
  }

  // --- state stream -------------------------------------------------------

  onState(fn: StateListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): [string, NodeState][] {
    return [...this.states.entries()];
  }

  private set(id: string, patch: Partial<NodeState>) {
    const next = { ...this.states.get(id)!, ...patch };
    this.states.set(id, next);
    for (const fn of this.listeners) fn(id, next);
  }

  // --- graph topology -----------------------------------------------------

  /** All transitive upstream node ids of `id`, plus `id`, in process order. */
  private plan(id: string): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      for (const e of this.edges) if (e.to === n) visit(e.from);
      order.push(n);
    };
    visit(id);
    return order;
  }

  private downstream(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (n: string) => {
      for (const e of this.edges)
        if (e.from === n && !seen.has(e.to)) {
          seen.add(e.to);
          out.push(e.to);
          visit(e.to);
        }
    };
    visit(id);
    return out;
  }

  // --- input resolution ---------------------------------------------------

  /**
   * Build a node's resolved input ports: every `in:` key becomes literal
   * param value(s) merged with data pulled across connected edges.
   *
   * Multi-edge aggregation is a verbatim port of legacy
   * `graph.ts#getPortData`: collect each connected value, drop `undefined`
   * (unproduced upstream), then — its exact rule —
   * `data.length === 1 ? data[0] : _.flatten(data)`. The depth-1 flatten is
   * the whole point: two edges into one `data` port means the producers'
   * **arrays are concatenated**, not nested. `_.flatten` === `Array.flat()`
   * (depth 1): a lone producer's array passes through untouched; non-array
   * values pass through too. Nodes therefore receive a flat list and never
   * special-case this themselves (legacy `Annotate` is a bare `data.map`) —
   * the earlier per-node flatten was a symptom patch for this missing port
   * semantic and has been reverted.
   */
  private resolveInputs(id: string): Record<string, unknown> {
    const def = this.file.nodes[id];
    const inputs: Record<string, unknown> = {};
    const raw = def?.in ?? {};
    for (const [port, value] of Object.entries(raw)) {
      const values: unknown[] = [];
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) {
        const uri = parseCocoonUri(v);
        if (uri) values.push(this.store.get(`${uri.id}/${uri.port.name}`));
        else values.push(v);
      }
      const present = values.filter(v => v !== undefined);
      inputs[port] = present.length <= 1 ? present[0] : present.flat();
    }
    return inputs;
  }

  private cachePath(id: string) {
    return path.join(path.dirname(this.filePath), '_cocoon_cache', `${id}.json`);
  }

  /**
   * Backing impl of `ctx.resolvePath` (both `ProcessContext` and
   * `ControlContext` — see `contract.ts`): the single flow-relative path
   * primitive. A leading `~` in the first segment → `$HOME` (matching the
   * legacy `Download` idiom — no `os` import); then `path.resolve(<flow
   * dir>, …)` so absolute segments pass through. No args ⇒ the flow dir
   * (a subprocess `cwd`). One impl, injected into every node/control context,
   * so a future contract change is absorbed here, not in N nodes.
   */
  private resolveFlowPath(...segments: string[]): string {
    const dir = path.dirname(this.filePath);
    if (segments.length === 0) return path.resolve(dir);
    const [first, ...rest] = segments;
    const head =
      first[0] === '~'
        ? path.join(process.env.HOME ?? '', first.slice(1))
        : first;
    return path.resolve(dir, head, ...rest);
  }

  /**
   * Backing impl of `ctx.processTemporaryNode` — faithful port of legacy
   * `@cocoon/util/processTemporaryNode` (+ `createTemporaryNodeContext` +
   * `requireCocoonNode`, the whole 3-file mechanism inlined). Legacy did
   * `requireCocoonNode(context.registry, type)`; the prototype is
   * registry-free, so resolution is the convention resolver here on the
   * runtime — which is *why* this is a runtime-backed `ctx` method, not a
   * standalone importable function (it has no other way to reach the
   * resolver). Sibling of `resolveFlowPath`: one impl, injected per node.
   *
   * `callerId` is the node whose `process()` is composing — kept stable
   * through nesting, so the self-composite guard (and `nodeId`/`resolvePath`)
   * always reflect the *original* node, exactly as legacy's `{...context}`
   * spread carried the original `graphNode` through nested temp contexts.
   */
  private async *runTemporaryNode(
    callerId: string,
    nodeType: string,
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
    opts?: { debug?: (...args: unknown[]) => void }
  ): AsyncGenerator<Progress, void, void> {
    if (nodeType === this.file.nodes[callerId]?.type)
      throw new Error('a node can not be a composite of itself');
    const { node, error } = await this.resolver.resolve(nodeType);
    if (!node) throw new Error(error ?? `Unknown node type "${nodeType}"`);

    // The temp context: legacy `{...context, ports:{read,write}}`. The
    // sub-node has no graph identity, so `controls` is empty (it reads its
    // config from `inputs`; legacy had no controls concept here at all) and
    // `debug` defaults to the caller's logger unless `opts.debug` overrides
    // it — the sole field legacy callers ever replaced.
    const tempCtx: ProcessContext = {
      cocoonFilePath: this.filePath,
      resolvePath: (...s: string[]) => this.resolveFlowPath(...s),
      nodeId: callerId,
      debug:
        opts?.debug ?? ((...a: unknown[]) => console.error(`[${callerId}]`, ...a)),
      ports: {
        read: () => inputs,
        write: (data: Record<string, unknown>) => Object.assign(outputs, data),
      },
      controls: { read: () => ({}) },
      processTemporaryNode: (t, i, o, op) =>
        this.runTemporaryNode(callerId, t, i, o, op),
    };

    // Forward progress, discard the summary — legacy
    // `for await (const progress of processor) yield progress`.
    yield* node.process(tempCtx);
  }

  private persistEnabled(id: string) {
    const override = this.persistOverride.get(id);
    if (override !== undefined) return override;
    const def = this.file.nodes[id];
    return (
      def?.persist === true ||
      (def?.persist === undefined &&
        this.resolver.peek(def?.type)?.persist === true)
    );
  }

  /**
   * Restore one node from its on-disk persist cache into the store + state,
   * returning whether it hit. Shared by `hydrate()` (background, load/reload)
   * and `runOne()`'s serve-from-cache fast path — so it **de-dupes**: if both
   * want the same node, they share one stream-parse rather than reading a
   * 542 MiB cache twice at once (heap risk). `gen` is the generation the
   * caller observed; a result parsed under a stale generation (a `reload()`
   * cleared the store meanwhile) is discarded instead of resurrected.
   */
  private restoreFromCache(
    id: string,
    gen: number = this.generation
  ): Promise<boolean> {
    const existing = this.restoreInFlight.get(id);
    if (existing) return existing;
    const p = this.doRestoreFromCache(id, gen).finally(() =>
      this.restoreInFlight.delete(id)
    );
    this.restoreInFlight.set(id, p);
    return p;
  }

  /**
   * The actual restore. Never swallows the failure silently — a present-but-
   * unrestorable cache is logged loudly (that is exactly how the >512 MiB
   * ImportBGGData regression stayed invisible).
   */
  private async doRestoreFromCache(
    id: string,
    gen: number
  ): Promise<boolean> {
    // Show the restore as work in progress. A cold (`idle`) node — the
    // background-hydrate case — flips to the regular `running` state so the
    // editor visibly lights it up while its (possibly 542 MiB) cache streams,
    // instead of sitting silent until it snaps to `done`. We only own that
    // flip when *we* made it (prior was `idle`); the `runOne` fast-path
    // already set `running` itself, so we don't touch its lifecycle — but we
    // still feed it the byte progress below.
    const tookRunning =
      gen === this.generation &&
      !!this.file.nodes[id] &&
      this.states.get(id)?.status === 'idle';
    if (tookRunning)
      this.set(id, {
        status: 'running',
        progress: 'Restoring from cache…',
        summary: undefined,
        error: undefined,
        errorStack: undefined,
      });
    let lastEmit = 0;
    const onBytes = (total: number) => {
      if (gen !== this.generation) return; // superseded — stop painting
      const now = Date.now();
      if (now - lastEmit < 150) return; // throttle the state stream
      lastEmit = now;
      this.set(id, {
        status: 'running',
        progress: `Restoring from cache… ${(total / 1048576).toFixed(1)} MB`,
      });
    };
    try {
      const cached = await readPersistedCache(this.cachePath(id), onBytes);
      // A reload cleared the store / dropped this node while we streamed —
      // don't write a result into a graph that has moved on.
      if (gen !== this.generation || !this.file.nodes[id]) return false;
      const ports: Record<string, number> = {};
      for (const [p, v] of Object.entries(cached)) {
        this.store.set(`${id}/${p}`, v);
        ports[p] = itemCount(v);
      }
      // Static `out:` literals are cheap, deterministic YAML — re-seed them
      // even on a cache hit so a downstream node reading them still resolves.
      for (const [p, v] of Object.entries(this.seedStaticOut(id)))
        ports[p] = itemCount(v);
      this.set(id, {
        status: 'done',
        summary: `Restored from cache (${Object.entries(ports)
          .map(([p, n]) => `${p}: ${n}`)
          .join(', ')})`,
        ports,
        progress: undefined,
        ...this.controlPatch(id),
      });
      // Re-derive the free-form control's bounded payload from the restored
      // output + durable file so a persisted control/visualisation node
      // shows its surface without a re-pull (the runOne done-path twin).
      this.set(id, await this.controlStatePatch(id));
      return true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === 'ENOENT') {
        console.error(`[${id}] no persist cache — will compute on run`);
      } else {
        console.error(
          `[${id}] persist cache present but unrestorable — will recompute` +
            ` (${e?.message ?? String(err)})`
        );
      }
      // Undo our optimistic `running` flip (only ours — never a `runOne`
      // that's about to actually process): a missing/bad cache must land the
      // node back at `idle`, not strand it spinning. `runOne`'s own `running`
      // (tookRunning === false) is left for it to resolve to done/error.
      if (
        tookRunning &&
        gen === this.generation &&
        this.states.get(id)?.status === 'running'
      )
        this.set(id, { status: 'idle', progress: undefined });
      return false;
    }
  }

  /**
   * Bring every persisted node up `done` from its disk cache, streaming each
   * as it finishes (the editor sees nodes light up one by one — legacy "they
   * stream in", never a freeze). Legacy Cocoon restored on start, not on
   * first run: with the result already in `store`, a downstream `process()`
   * memoises the expensive upstream instead of recomputing it. Sequential on
   * purpose — a single cache (ImportBGGData ≈ 542 MiB / 153k rows) is already
   * heavy; parsing several at once would risk the heap. Topological order so
   * a persisted node's upstream is already seeded when its own cache lands
   * (a downstream `process()` then memoises it). Skips a node that is no
   * longer `idle` (a concurrent
   * `runOne` already restored/started it — its serve-from-cache shares this
   * one's parse via the in-flight de-dupe, so the cache is read once), and
   * bails entirely once a newer generation supersedes this run.
   */
  private async hydratePersisted(gen: number): Promise<void> {
    for (const id of this.topoOrder()) {
      if (gen !== this.generation) return;
      if (this.persistEnabled(id) && this.states.get(id)?.status === 'idle')
        await this.restoreFromCache(id, gen);
    }
  }

  /** Global dependency order — every node, upstream before downstream. */
  private topoOrder(): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      for (const e of this.edges) if (e.to === n) visit(e.from);
      order.push(n);
    };
    for (const id of Object.keys(this.file.nodes)) visit(id);
    return order;
  }

  /** Collect a node's current output ports from the store, port -> data. */
  private outputsOf(id: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, v] of this.store)
      if (key.startsWith(`${id}/`)) out[key.slice(id.length + 1)] = v;
    return out;
  }

  /**
   * Toggle disk-persistence for one node. A runtime/session override — by
   * design it never rewrites the YAML (the editor owns only edges + position;
   * the processing instance is the source of truth). Enabling a node that has
   * already produced output writes its cache immediately so the toggle is felt
   * without a re-run; disabling only stops future caching (use `invalidate`
   * to actually clear the cache file).
   */
  async setPersist(id: string, value: boolean) {
    if (!this.file.nodes[id]) return;
    this.persistOverride.set(id, value);
    this.set(id, { persist: value });
    if (value) {
      // Enabling with output already present: write the cache now so the
      // toggle is felt without a re-run.
      if (this.hasOutputs(id)) {
        await writePersistedCache(this.cachePath(id), this.outputsOf(id));
      }
    } else {
      // Disabling means "this node is no longer persisted" — so its on-disk
      // cache must go too, else a lingering file silently feeds a future run.
      // The live in-memory output and `done` status are untouched (persist is
      // about disk caching, not the result itself — that's what trash is for).
      try {
        await fs.rm(this.cachePath(id));
      } catch {
        /* no cache file — fine */
      }
    }
  }

  // --- steering controls (keystone 5) -------------------------------------

  /**
   * A node's code-declared control schema, or `undefined` — lazy by the same
   * keystone-6 discipline as everything else: `resolver.peek` is synchronous
   * and returns the module only once it has been resolved (the node ran /
   * was peeked). No eager module load just to learn a schema; the schema
   * rides node-state once it's known (`controlPatch`). Direct twin of
   * `persistEnabled`'s `resolver.peek(type)?.persist`.
   */
  private controlSchemaOf(
    id: string
  ): Record<string, ControlSchema> | undefined {
    return this.resolver.peek(this.file.nodes[id]?.type)?.controls;
  }

  /**
   * Absolute file backing `type`'s module **iff it exports a browser
   * `hook`** (keystone 2/5). The HTTP delivery seam (`serve.ts`)
   * esbuild-bundles exactly this file's `hook`. Lazy/cache-based like every
   * resolver peek — defined once the type has resolved (a run / peek), the
   * same moment `NodeState.controlHook` starts streaming.
   */
  controlHookFile(type: string | undefined): string | undefined {
    if (this.resolver.peekHookMtime(type) === undefined) return undefined;
    return this.resolver.peekFile(type);
  }

  /** Effective control values: the runtime overlay over schema defaults. */
  private effectiveControls(
    id: string,
    schema: Record<string, ControlSchema>
  ): Record<string, unknown> {
    const ov = this.controlOverride.get(id) ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(schema))
      out[k] = k in ov ? ov[k] : controlDefault(c);
    return out;
  }

  /**
   * The `{ controls, controlState }` slice of node-state, or `{}` when the
   * node declares none / its module hasn't resolved yet (lazy). Folded into
   * the `done` set (schema becomes known the moment the module resolves) and
   * re-emitted by `setControl`.
   */
  private controlPatch(id: string): Partial<NodeState> {
    const schema = this.controlSchemaOf(id);
    if (!schema || !Object.keys(schema).length) return {};
    return { controls: schema, controlState: this.effectiveControls(id, schema) };
  }

  /**
   * Set one steering control's value — the `setPersist` twin (keystone 5 is
   * persist's mechanism generalised). A pure-pull, side-effect-free op:
   *
   *  - validates against the code-declared schema; an unknown node/key, a
   *    not-yet-resolved schema, or a value of the wrong shape is a **no-op**
   *    (fire-and-forget, like `setPersist` on an unknown node — the agent
   *    reads the schema via `query node` first, so by write time it's known);
   *  - records the value in the session `controlOverride` (never YAML);
   *  - ages the node and its downstream (`markStale` — its current output was
   *    computed under the *old* knob; the persist cache is dropped). It does
   *    **not** pull upstream, re-`process()`, or eager-cascade — the user
   *    re-pulls. That is the whole steering contract.
   */
  async setControl(id: string, key: string, value: unknown) {
    if (!this.file.nodes[id]) return;
    const cs = this.controlSchemaOf(id)?.[key];
    if (!cs || !controlValid(cs, value)) return;
    const cur = this.controlOverride.get(id) ?? {};
    this.controlOverride.set(id, { ...cur, [key]: value });
    // Pure pull: deliberately not recomputed (this is a pull graph). The old
    // result stays visible amber until the user re-pulls; downstream ages too.
    await this.markStale(id);
    for (const d of this.downstream(id)) await this.markStale(d);
    // Stream the new effective controlState (status already streamed by
    // markStale; this merge keeps it and updates the values).
    this.set(id, this.controlPatch(id));
  }

  // --- free-form controls (keystone 5 action tier, LiveView model) --------

  /**
   * The opaque, ephemeral control blob — *only* for unsaved input drafts
   * (e.g. Annotate's textarea before Save). NOT for derived state: a cursor
   * / batch membership must be re-derived from the durable truth, never
   * cached here (every cached-derived-state bug in this model came from
   * doing that). `process()` deliberately has no access to it — the data
   * transform stays pure; reconciliation is the control's `data()` half.
   */
  /** The node's own written output ports (`{}` before first pull). The
   *  pull-graph snapshot — frozen between pulls, kept across `stale`. */
  private nodeOutputs(id: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const prefix = `${id}/`;
    for (const [k, v] of this.store)
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    return out;
  }

  private controlBlobApi(id: string) {
    return {
      read: () => this.controlBlob.get(id) ?? {},
      set: (patch: Record<string, unknown>) =>
        this.controlBlob.set(id, {
          ...(this.controlBlob.get(id) ?? {}),
          ...patch,
        }),
    };
  }

  private controlCtx(
    id: string,
    opts: {
      payload?: unknown;
      surface?: 'node' | 'window';
      data?: unknown;
      requestStale?: () => void;
    } = {}
  ): ControlContext {
    return {
      ports: { read: () => this.resolveInputs(id) },
      output: this.nodeOutputs(id),
      control: this.controlBlobApi(id),
      payload: opts.payload ?? {},
      surface: opts.surface ?? 'node',
      data: opts.data,
      markStale: opts.requestStale ?? (() => {}),
      debug: (...a: unknown[]) => console.error(`[${id}]`, ...a),
      cocoonFilePath: this.filePath,
      resolvePath: (...s: string[]) => this.resolveFlowPath(...s),
      nodeId: id,
    };
  }

  /**
   * The control's streamed state — the data/render split: a core-side
   * **data half** (`control.data`, async, reads resolved inputs + the
   * node's own durable file) produces a *bounded* payload; the **render
   * half** turns it into inert HTML per surface. Recomputed after
   * `process` AND after every control event — this is *presentation* (pure,
   * bounded, no graph execution), never a pull. The payload also streams as
   * `controlData` so the agent reads the same bounded slice the human sees
   * (the AI read surface, for free — no HTML scraping).
   */
  private async controlStatePatch(id: string): Promise<Partial<NodeState>> {
    const type = this.file.nodes[id]?.type;
    const ctl = this.resolver.peek(type)?.control;
    if (!ctl?.render) return {};
    // Browser hot-reload twin of the resolver's `?m=<mtime>`: streamed so
    // the editor mtime-busts its dynamic `import()` of the node's `hook`.
    const hookMtime = this.resolver.peekHookMtime(type);
    let data: unknown;
    try {
      data = ctl.data ? await ctl.data(this.controlCtx(id)) : undefined;
    } catch (err) {
      this.set(id, {}); // best-effort; fall through to an error render
      data = { error: err instanceof Error ? err.message : String(err) };
    }
    const render = (surface: 'node' | 'window') => {
      try {
        return ctl.render(this.controlCtx(id, { surface, data }));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return `<pre class="control-error">control render failed: ${m}</pre>`;
      }
    };
    return {
      controlHtml: render('node'),
      controlWindowHtml: render('window'),
      controlData: data,
      controlHook:
        hookMtime === undefined ? undefined : { mtimeMs: hookMtime },
    };
  }

  /**
   * Handle a free-form control event. Off `runOne` with its own try/catch —
   * a handler throw is logged, never rethrown (must not abort a plan) and
   * never sets the node's `error` status (the node is still done/stale; the
   * *event* failed). `$mount` is the lifecycle event the shim fires when a
   * surface appears: it skips the handler and just re-derives + streams (so
   * a control shows its live batch as soon as it's visible, pre-pull).
   *
   * A handler changes the *durable truth* (writes the node's file) and may
   * `ctx.markStale()` — the node's output is now outdated, the user pulls
   * when they want it folded downstream. There is **no rerun**: the control
   * stays live by re-deriving its own bounded payload from the file
   * (`controlStatePatch`), which is presentation, not graph execution.
   */
  async controlEvent(id: string, event: string, payload?: unknown) {
    const def = this.file.nodes[id];
    if (!def) return;
    let ctl = this.resolver.peek(def.type)?.control;
    if (!ctl) {
      // Lazy — force a resolve so a surface can appear before first pull.
      ctl = (await this.resolver.resolve(def.type)).node?.control;
    }
    if (!ctl) return;
    let stale = false;
    if (event !== '$mount' && ctl.event) {
      const ctx = this.controlCtx(id, {
        payload: payload ?? {},
        requestStale: () => {
          stale = true;
        },
      });
      try {
        await ctl.event(ctx, { event, payload: payload ?? {} });
      } catch (err) {
        console.error(
          `[${id}] control event "${event}" failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (stale) {
      // The node's output is outdated (the handler changed its file). Honest
      // pull signal — NOT a rerun: the user pulls to fold it downstream.
      await this.markStale(id);
      for (const d of this.downstream(id)) await this.markStale(d);
    }
    // Re-derive the control's own bounded payload from the (now-updated)
    // file and re-render. Presentation only — no process(), no graph.
    this.set(id, await this.controlStatePatch(id));
  }

  /**
   * Legacy `writeToPorts(node, definition.out)`: a node def's static `out:`
   * literals seed — and *override* — output ports after processing (e.g.
   * `out: { src: plot.png }` puts the string `"plot.png"` on the `src` port
   * a downstream node can read). Plain shallow set, exactly as legacy.
   * Returns the seeded entries so callers fold them into port stats / cache.
   */
  private seedStaticOut(id: string): Record<string, unknown> {
    const out = this.file.nodes[id]?.out;
    const seeded: Record<string, unknown> = {};
    if (out && typeof out === 'object') {
      for (const [p, v] of Object.entries(out)) {
        this.store.set(`${id}/${p}`, v);
        seeded[p] = v;
      }
    }
    return seeded;
  }

  // --- processing ---------------------------------------------------------

  /**
   * Process `id` and everything it depends on; memoised + persist-aware.
   * Serialised: concurrent calls queue behind one another so a shared
   * upstream is never run twice at once (see `processChain`).
   */
  process(targetId: string): Promise<void> {
    const run = this.processChain.then(() => this.runPlan(targetId));
    // Keep the chain alive even if this plan rejects (a failed target
    // throws for headless `run`); the next queued process must still go.
    this.processChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async runPlan(targetId: string): Promise<void> {
    // "Run to here" makes the target the fresh frontier: every node strictly
    // downstream was computed from the *old* target output, so flag it stale
    // (same treatment a sibling branch gets when a shared upstream re-runs).
    // The old result stays visible, amber, "click to re-run"; a hard wipe is
    // the explicit 🗑 trash, not an implicit side-effect of running upstream.
    for (const d of this.downstream(targetId)) await this.markStale(d);

    // Memoisation skips a `done` node — but it is for the *transitive
    // upstream* (don't recompute the chain), NOT for the explicitly-pulled
    // target. "Run to here" is a direct user request on that node: a green
    // target must re-run, not silently no-op (the user clicked a button and
    // expects work). Only `id !== targetId` is memoise-eligible; the target
    // always runs (its persisted-cache fast path in `runOne` still applies —
    // persist means "serve cached" by definition, that's a separate intent).
    const order = this.plan(targetId);
    for (const id of order) {
      const st = this.states.get(id);
      if (id !== targetId && st?.status === 'done' && this.hasOutputs(id))
        continue;
      if (st && st.status !== 'queued')
        this.set(id, {
          status: 'queued',
          error: undefined,
          errorStack: undefined,
          inputDigest: undefined,
          errorAt: undefined,
        });
    }
    // A node can't execute past an upstream error. Walk the plan in
    // topological order; if any of a node's edge inputs failed (or produced
    // no output), it's *blocked* — surfaced explicitly so it never sits in
    // `queued` limbo — and its own dependents block in turn.
    const failed = new Set<string>();
    for (const id of order) {
      const st = this.states.get(id)!;
      // Same rule as the queue pass: memoise upstream, never the target.
      if (id !== targetId && st.status === 'done' && this.hasOutputs(id))
        continue;

      const blockers = this.edges
        .filter(e => e.to === id)
        .map(e => e.from)
        .filter(dep => failed.has(dep) || !this.hasOutputs(dep));
      if (blockers.length) {
        failed.add(id);
        this.set(id, {
          status: 'error',
          error: `Blocked — upstream ${[...new Set(blockers)]
            .map(b => `"${b}"`)
            .join(', ')} failed`,
          summary: undefined,
          progress: undefined,
          // A block is not a throw — no stack/inputs/offending item, and
          // clear any stale ones from this node's previous real failure.
          errorStack: undefined,
          inputDigest: undefined,
          errorAt: undefined,
          ports: {},
        });
        continue;
      }

      await this.runOne(id);
      if (this.states.get(id)!.status === 'error') failed.add(id);
    }

    // Headless `cocoon run` must exit non-zero when the requested target
    // couldn't be produced; unrelated failed branches don't count.
    if (failed.has(targetId)) {
      throw new Error(
        `Cannot process "${targetId}": ${
          this.states.get(targetId)?.error ?? 'upstream failure'
        }`
      );
    }
  }

  /** Drop a node's output + persisted cache so the next process re-runs it. */
  async invalidate(id: string) {
    for (const key of [...this.store.keys()])
      if (key.startsWith(`${id}/`)) this.store.delete(key);
    try {
      await fs.rm(this.cachePath(id));
    } catch {
      /* no cache file — fine */
    }
    this.set(id, {
      status: 'idle',
      summary: undefined,
      progress: undefined,
      error: undefined,
      errorStack: undefined,
      inputDigest: undefined,
      errorAt: undefined,
      ports: {},
    });
  }

  /**
   * Mark a previously-`done` node `stale`: its inputs changed (an upstream
   * re-ran, or you ran to a node earlier in its chain) but we deliberately
   * don't recompute it — this is a pull graph. The in-memory output is kept
   * so the last result stays *visible* (bordered amber, "click to re-run");
   * only the on-disk persist cache is dropped, because a
   * `stale` node isn't memoised and would otherwise be silently "resolved" by
   * restoring its now-outdated cache instead of actually recomputing.
   */
  private async markStale(id: string) {
    if (this.states.get(id)?.status !== 'done') return; // nothing valid to age
    if (this.persistEnabled(id)) {
      try {
        await fs.rm(this.cachePath(id));
      } catch {
        /* no cache file — fine */
      }
    }
    this.set(id, { status: 'stale' });
  }

  private hasOutputs(id: string) {
    for (const key of this.store.keys()) if (key.startsWith(`${id}/`)) return true;
    return false;
  }

  private async runOne(id: string): Promise<void> {
    const def = this.file.nodes[id];
    const { node, error: resolveError } = await this.resolver.resolve(
      def?.type
    );
    if (!node) {
      // Lazy resolution: the reason (unknown type / collision / failed
      // import) is computed here, not at load. Record import failures by
      // type so the AI digest (`loadErrors`) still surfaces broken nodes.
      const reason = resolveError ?? `Unknown node type "${def?.type}"`;
      if (def?.type && /failed to load/.test(reason))
        this.nodeLoadErrors.set(def.type, reason);
      this.set(id, { status: 'error', error: reason });
      return;
    }

    this.set(id, {
      status: 'running',
      error: undefined,
      errorStack: undefined,
      inputDigest: undefined,
      errorAt: undefined,
      progress: undefined,
    });

    // Engine-level persist: serve from disk cache instead of processing.
    // Background `hydrate()` usually wins the race (then `process()` memoises
    // it), but this still covers a run that reaches a persisted node before
    // hydration streamed that far, a cache that appeared since load (persist
    // just toggled on), or hydration skipped/superseded. The in-flight
    // de-dupe means a concurrent hydrate and this share one parse.
    if (this.persistEnabled(id) && (await this.restoreFromCache(id))) return;

    const written: Record<string, unknown> = {};
    const ctx = {
      cocoonFilePath: this.filePath,
      resolvePath: (...s: string[]) => this.resolveFlowPath(...s),
      processTemporaryNode: (
        t: string,
        i: Record<string, unknown>,
        o: Record<string, unknown>,
        op?: { debug?: (...a: unknown[]) => void }
      ) => this.runTemporaryNode(id, t, i, o, op),
      nodeId: id,
      debug: (...a: unknown[]) => console.error(`[${id}]`, ...a),
      ports: {
        read: () => this.resolveInputs(id),
        write: (data: Record<string, unknown>) => {
          for (const [p, v] of Object.entries(data)) {
            written[p] = v;
            this.store.set(`${id}/${p}`, v);
          }
        },
      },
      // Effective steering values: the runtime overlay over this node's own
      // declared schema (authoritative — we hold the resolved `node` here, no
      // peek needed). `{}` when it declares none.
      controls: {
        read: () =>
          node.controls ? this.effectiveControls(id, node.controls) : {},
      },
    };

    try {
      // Guarded: an out-of-band crash from the node's async I/O (an
      // uncaughtException/unhandledRejection that never reaches the `await`
      // below — e.g. `pg` throwing from a socket handler) is rerouted here as
      // a rejection instead of killing the core. See node-guard.ts.
      await guardNodeRun(id, async () => {
        const gen = node.process(ctx);
        let summary: string | void;
        while (true) {
          const r = await gen.next();
          if (r.done) {
            summary = r.value;
            break;
          }
          const p = r.value;
          if (p !== undefined)
            this.set(id, { progress: Array.isArray(p) ? p[0] : p });
        }

        // Static `out:` literals seed and *override* written ports (legacy
        // `writeToPorts(node, definition.out)`), and are persisted with them.
        Object.assign(written, this.seedStaticOut(id));

        const ports: Record<string, number> = {};
        for (const [p, v] of Object.entries(written)) ports[p] = itemCount(v);

        if (this.persistEnabled(id)) {
          await writePersistedCache(this.cachePath(id), written);
        }

        this.set(id, {
          status: 'done',
          summary: summary || 'Processed',
          ports,
          progress: undefined,
          // The module just resolved, so its steering schema is now known
          // (resolver.peek hits modCache) — stream it alongside the result.
          ...this.controlPatch(id),
        });
        // Free-form control: re-derive its bounded payload from the freshly
        // processed state + durable file and stream both surfaces. Async
        // (the data half may read the file), so a second set, not folded in.
        this.set(id, await this.controlStatePatch(id));

        // A re-run ages anything computed from this node (markStale no-ops on
        // nodes that weren't `done`, and drops their persist cache if any).
        for (const d of this.downstream(id)) await this.markStale(d);
      });
    } catch (err) {
      // Record the failure and return — never rethrow. A thrown error here
      // would abort the whole plan loop and strand every later-planned node
      // in `queued` forever. The plan (process) decides what a failure means
      // for the rest of the graph: dependents are *blocked*, not limbo.
      //
      // Diagnostics for the AI debug loop (closes the documented "errors
      // carry no stack" gap): the stack (where), a bounded digest of the
      // resolved inputs (what was fed in — node-agnostic), and, when a
      // core-owned per-item node attached it, the exact offending
      // index+record via the `cocoonErrorAt` convention. All best-effort:
      // error reporting must itself never throw.
      let inputDigest: unknown;
      try {
        inputDigest = digest(this.resolveInputs(id));
      } catch {
        /* inputs unreadable — omit */
      }
      const at = (err as { cocoonErrorAt?: { index: number; record: unknown } })
        ?.cocoonErrorAt;
      this.set(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack : undefined,
        inputDigest,
        errorAt: at
          ? { index: at.index, record: digest(at.record) }
          : undefined,
        progress: undefined,
      });
    }
  }

  /** Read a port's data by `cocoon://id/out/port` — used by headless run. */
  readPort(uri: string): unknown {
    const parsed = parseCocoonUri(uri);
    if (!parsed) throw new Error(`Not a cocoon:// uri: ${uri}`);
    return this.store.get(`${parsed.id}/${parsed.port.name}`);
  }
}
