/**
 * The processing engine. Transport-agnostic and browser-free by design: the
 * CLI uses it headless, the WebSocket server wraps it for the editor, and an
 * AI/text frontend can drive it the same way. It owns ALL port data; clients
 * only ever receive node *state* (status / summary / per-port counts), never
 * bulk data — that's the whole point of the split.
 */
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  extractEdges,
  type CocoonEdge,
  type CocoonFile,
} from '../src/lib/cocoon-file.ts';
import { parseCocoonUri, parseViewString } from '../src/lib/cocoon-uri.ts';
import type { NodeState } from '../src/lib/protocol.ts';
import { views } from '../src/lib/views/index.ts';
import type { Registry } from './contract.ts';
import { digest, peekData, type PeekOptions } from './introspect.ts';
import { loadFlowEnv } from './load-env.ts';
import { loadProjectNodes } from './load-nodes.ts';
import { guardNodeRun } from './node-guard.ts';
import { readPersistedCache, writePersistedCache } from './persist-cache.ts';
import { registry as defaultRegistry } from './nodes/index.ts';

const itemCount = (v: unknown) =>
  Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1;

export type StateListener = (id: string, state: NodeState) => void;

export class Runtime {
  readonly filePath: string;
  yaml: string;
  file!: CocoonFile;
  edges: CocoonEdge[] = [];

  private base: Registry;
  private registry: Registry;
  /** `${nodeId}/${port}` -> data. The single source of truth for port data. */
  private store = new Map<string, unknown>();
  private states = new Map<string, NodeState>();
  private listeners = new Set<StateListener>();
  /** Live persist toggles from the editor. Never written back to YAML. */
  private persistOverride = new Map<string, boolean>();
  /** Custom-node modules that failed to import (`spec -> reason`). */
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

  private constructor(
    filePath: string,
    yaml: string,
    base: Registry,
    registry: Registry
  ) {
    this.filePath = filePath;
    this.yaml = yaml;
    this.base = base;
    this.registry = registry;
  }

  static async load(filePath: string, base: Registry = defaultRegistry) {
    const abs = path.resolve(filePath);
    const [yaml, loaded] = await Promise.all([
      fs.readFile(abs, 'utf8'),
      loadProjectNodes(abs, base),
    ]);
    const rt = new Runtime(abs, yaml, base, loaded.registry);
    rt.nodeLoadErrors = loaded.errors;
    rt.file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!rt.file.nodes) rt.file.nodes = {};
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
   * Re-read the YAML after the flow was edited on disk (the AI builds/wires a
   * node, then asks to reload). Full reset by design: the store is cleared
   * and every node returns to `idle` — predictable — then a background
   * `hydrate()` streams persisted nodes back to `done` from their disk cache
   * (so the expensive upstream is restored, not recomputed, on the next run),
   * without blocking the reload while a big cache parses. Custom-node modules
   * are re-imported
   * so a just-authored/just-fixed node file is picked up. Per-node `persist`
   * session overrides survive for nodes that still exist (they are file-
   * independent); overrides for removed nodes are dropped.
   */
  async reload() {
    // Supersede any still-running background hydration from the previous
    // load: its captured generation is now stale, so a late-finishing parse
    // won't resurrect a node into the store this reload is about to clear.
    this.generation++;
    const loaded = await loadProjectNodes(this.filePath, this.base);
    this.registry = loaded.registry;
    this.nodeLoadErrors = loaded.errors;
    this.yaml = await fs.readFile(this.filePath, 'utf8');
    this.file = (parse(this.yaml) ?? { nodes: {} }) as CocoonFile;
    if (!this.file.nodes) this.file.nodes = {};
    loadFlowEnv(this.filePath, this.file.env);
    this.edges = extractEdges(this.file);
    this.store.clear();
    for (const id of [...this.persistOverride.keys()])
      if (!this.file.nodes[id]) this.persistOverride.delete(id);
    this.resetStates();
    // Re-light persisted nodes from disk in the background: each streams to
    // `done` (and re-broadcasts to the listening editor) as its cache
    // finishes. Not awaited — a 542 MiB cache must not freeze the
    // "fix it, watch it light up" reload loop.
    void this.hydrate();
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

  private persistEnabled(id: string) {
    const override = this.persistOverride.get(id);
    if (override !== undefined) return override;
    const def = this.file.nodes[id];
    return (
      def?.persist === true ||
      (def?.persist === undefined &&
        this.registry[def?.type]?.persist === true)
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
      // even on a cache hit so a view bound to e.g. `src` still resolves.
      for (const [p, v] of Object.entries(this.seedStaticOut(id)))
        ports[p] = itemCount(v);
      this.set(id, {
        status: 'done',
        summary: `Restored from cache (${Object.entries(ports)
          .map(([p, n]) => `${p}: ${n}`)
          .join(', ')})`,
        ports,
        progress: undefined,
        viewData: this.computeViewData(id),
      });
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
   * a persisted node whose view binds an *input* port sees its upstream
   * already seeded. Skips a node that is no longer `idle` (a concurrent
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

  /**
   * Run the attached view's pure `serialiseViewData` half *here in the core*
   * and return only the reduced payload. The bulk port data never leaves the
   * core — exactly what the ViewDataLogic/ViewRenderer split is for.
   */
  private computeViewData(id: string): unknown {
    const def = this.file.nodes[id];
    if (!def?.view) return undefined;
    const { type, port } = parseViewString(def.view);
    const view = views[type];
    if (!view) return undefined;
    // A type-only view string (`view: Image`) binds to the view's own
    // `defaultPort` (legacy parity — e.g. Image → the `src` output port),
    // falling back to the outgoing `data` port. A view bound to an *input*
    // port (`in/<port>/<Type>`) must show what the node reads there —
    // resolved exactly as the node does (literal params + data pulled across
    // edges), never the node's own like-named output.
    const bind = port ?? view.defaultPort;
    const data = bind?.incoming
      ? this.resolveInputs(id)[bind.name]
      : this.store.get(`${id}/${bind?.name ?? 'data'}`);
    const arr = Array.isArray(data) ? data : data === undefined ? [] : [data];
    try {
      return view.serialiseViewData(
        arr,
        (def.viewState ?? {}) as never,
        this.viewContext()
      );
    } catch (err) {
      console.error(`[${id}] view "${type}" serialise failed:`, err);
      return undefined;
    }
  }

  /**
   * Filesystem capability handed to `serialiseViewData` (it runs here in the
   * core, never the browser). Relative paths resolve against the cocoon
   * file's directory, like the I/O nodes. MIME is guessed from the extension
   * (defaulting to `image/png`, legacy-faithful).
   */
  private viewContext() {
    const dir = path.dirname(this.filePath);
    const mimes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    return {
      readFileBase64(filePath: string) {
        try {
          const abs = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(dir, filePath);
          return {
            base64: readFileSync(abs).toString('base64'),
            mime: mimes[path.extname(abs).toLowerCase()] ?? 'image/png',
          };
        } catch {
          return null;
        }
      },
    };
  }

  /**
   * Legacy `writeToPorts(node, definition.out)`: a node def's static `out:`
   * literals seed — and *override* — output ports after processing (e.g.
   * `out: { src: plot.png }` puts the string `"plot.png"` on the `src` port,
   * which an `Image` view then reads). Plain shallow set, exactly as legacy.
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

    const order = this.plan(targetId);
    for (const id of order) {
      const st = this.states.get(id);
      if (st && (st.status === 'done') && this.hasOutputs(id)) continue;
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
      if (st.status === 'done' && this.hasOutputs(id)) continue;

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
          viewData: undefined,
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
      viewData: undefined,
      ports: {},
    });
  }

  /**
   * Mark a previously-`done` node `stale`: its inputs changed (an upstream
   * re-ran, or you ran to a node earlier in its chain) but we deliberately
   * don't recompute it — this is a pull graph. The in-memory output and the
   * view payload are kept so the last result stays *visible* (bordered amber,
   * "click to re-run"); only the on-disk persist cache is dropped, because a
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
    const node = this.registry[def?.type];
    if (!node) {
      // A custom type can be "unknown" only because its module failed to
      // import — surface that reason instead of a bare "unknown type".
      const hint = this.nodeLoadErrors.size
        ? ` (custom node module(s) failed to load: ${[...this.nodeLoadErrors]
            .map(([spec, reason]) => `${spec}: ${reason}`)
            .join('; ')})`
        : '';
      this.set(id, {
        status: 'error',
        error: `Unknown node type "${def?.type}"${hint}`,
      });
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
          viewData: this.computeViewData(id),
        });

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
