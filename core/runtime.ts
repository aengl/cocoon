/**
 * Processing engine. Transport-agnostic; owns all port data. Clients only ever
 * receive node *state* (status / summary / per-port counts), never bulk data.
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
import { writePersistedCache } from './persist-cache.ts';
import { Hydration } from './hydration.ts';
import { diffReload, type ReloadDiff } from './reload-diff.ts';
import { NodeResolver } from './resolve-nodes.ts';
import {
  hasOutputs as storeHasOutputs,
  portMap,
  topoSort,
  transitiveDownstream,
} from './topology.ts';

const itemCount = (v: unknown) =>
  Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1;

/** Value before the editor/agent first touches a knob: declared `default`,
 *  else the kind's natural zero. */
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

/** Whether `v` is acceptable for control `c`. Invalid writes are dropped
 *  silently by `setControl` — `process()` never sees a bad value. */
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

/** The flow's `nodeDirs:` list (a pass-through key, resolved relative to the
 *  flow file). */
function nodeDirsOf(file: CocoonFile): string[] {
  const v = (file as { nodeDirs?: unknown }).nodeDirs;
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string')
    : [];
}

export type StateListener = (id: string, state: NodeState) => void;

export class Runtime {
  readonly filePath: string;
  yaml: string;
  file!: CocoonFile;
  edges: CocoonEdge[] = [];

  private resolver!: NodeResolver;
  /** `${nodeId}/${port}` -> data. Single source of truth for port data. */
  private store = new Map<string, unknown>();
  private states = new Map<string, NodeState>();
  private listeners = new Set<StateListener>();
  /** Session overlay; never written to YAML, reset on restart. */
  private persistOverride = new Map<string, boolean>();
  /** Steering values overlaid on the schema defaults. Session-only. */
  private controlOverride = new Map<string, Record<string, unknown>>();
  /** Opaque per-node blob owned by the node's `control.{render,event}`.
   *  The core only holds and streams it; never inspected. Session-only. */
  private controlBlob = new Map<string, Record<string, unknown>>();
  /** `type -> reason` for modules that failed to import. Filled lazily on
   *  first resolve so the AI digest can still surface broken nodes. */
  private nodeLoadErrors = new Map<string, string>();
  /** Background restore of persisted nodes — see core/hydration.ts. */
  private hydration!: Hydration;
  /** Bumped on every reload. A background hydration started under an older
   *  generation must not write into a store a newer reload has cleared. */
  private generation = 0;
  /**
   * Per-node `runOne()` dedupe — both within a plan (frontier scheduler
   * fires concurrently) and across overlapping plans (two `process()` calls
   * sharing an upstream join the same promise instead of re-running it).
   * Without this a late-finishing duplicate's `markStale` would age a
   * sibling that completed from the same data.
   */
  private inFlightRuns = new Map<string, Promise<void>>();

  private constructor(filePath: string, yaml: string) {
    this.filePath = filePath;
    this.yaml = yaml;
    this.hydration = new Hydration({
      cachePath: id => this.cachePath(id),
      hasNode: id => !!this.file.nodes[id],
      generation: () => this.generation,
      getStatus: id => this.states.get(id)?.status,
      setState: (id, patch) => this.set(id, patch),
      setStore: (id, port, v) => this.store.set(`${id}/${port}`, v),
      seedStaticOut: id => this.seedStaticOut(id),
      controlPatch: id => this.controlPatch(id),
      controlStatePatch: id => this.controlStatePatch(id),
      topoOrder: () => this.topoOrder(),
      persistEnabled: id => this.persistEnabled(id),
    });
  }

  static async load(filePath: string) {
    const abs = path.resolve(filePath);
    const yaml = await fs.readFile(abs, 'utf8');
    const rt = new Runtime(abs, yaml);
    rt.file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!rt.file.nodes) rt.file.nodes = {};
    rt.resolver = new NodeResolver({
      cocoonFilePath: abs,
      nodeDirs: nodeDirsOf(rt.file),
    });
    loadFlowEnv(abs, rt.file.env);
    rt.edges = extractEdges(rt.file);
    rt.resetStates();
    // Persisted nodes are NOT hydrated here. Big caches take real time to
    // stream-parse; blocking `load()` blocks `serve()`'s listen socket.
    // Long-lived frontends call `hydrate()` after wiring listeners.
    return rt;
  }

  private resetStates() {
    this.states.clear();
    for (const id of Object.keys(this.file.nodes))
      this.states.set(id, {
        status: 'idle',
        ports: {},
        persist: this.persistEnabled(id),
      });
  }

  get loadErrors(): ReadonlyMap<string, string> {
    return this.nodeLoadErrors;
  }

  /**
   * Re-read the flow file from disk. Selective by default: each node keeps
   * its result iff its own compute signature and entire transitive upstream
   * are unchanged (see `applyReloadDiff`). `nodeDirs`/`env` changes can shift
   * resolution for every node, so they force a full reset. Session overrides
   * (persist/controls) survive for nodes that still exist; orphans are
   * dropped. A background `hydrate()` re-lights persisted nodes after.
   *
   * `opts.fullReset` is the editor toolbar's deliberate "recompute everything"
   * — bypasses the diff regardless.
   */
  async reload(opts: { fullReset?: boolean } = {}) {
    // Parse into locals BEFORE mutating: the file watcher can fire mid-save
    // and `parse()` may throw on half-written bytes. A failed reload must
    // be a complete no-op, not a half-applied state.
    const yaml = await fs.readFile(this.filePath, 'utf8');
    const file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!file.nodes) file.nodes = {};
    const oldFile = this.file;
    const newEdges = extractEdges(file);
    const diff = diffReload(oldFile, file, newEdges, this.states, id =>
      this.persistOverride.get(id) ?? file.nodes[id]?.persist === true
    );

    // Past the throw point — commit. Bumping the generation supersedes any
    // background hydration from the previous load, so a late-finishing parse
    // can't resurrect a node this reload cleared.
    this.generation++;
    this.yaml = yaml;
    this.file = file;
    this.resolver = new NodeResolver({
      cocoonFilePath: this.filePath,
      nodeDirs: nodeDirsOf(this.file),
    });
    this.nodeLoadErrors.clear();
    loadFlowEnv(this.filePath, this.file.env);
    this.edges = newEdges;
    for (const id of [...this.persistOverride.keys()])
      if (!this.file.nodes[id]) this.persistOverride.delete(id);
    for (const id of [...this.controlOverride.keys()])
      if (!this.file.nodes[id]) this.controlOverride.delete(id);
    for (const id of [...this.controlBlob.keys()])
      if (!this.file.nodes[id]) this.controlBlob.delete(id);

    if (diff.globalReset || opts.fullReset) {
      this.store.clear();
      this.resetStates();
    } else {
      await this.applyReloadDiff(diff);
    }
    void this.hydrate();
  }

  /**
   * Apply the per-node verdicts from `diffReload` — the mutation side of the
   * selective reload (see `reload-diff.ts` for the decision logic).
   */
  private async applyReloadDiff(diff: ReloadDiff) {
    const dropStore = (id: string) => {
      for (const k of [...this.store.keys()])
        if (k.startsWith(`${id}/`)) this.store.delete(k);
    };

    for (const id of diff.removed) {
      dropStore(id);
      this.states.delete(id);
      this.hydration.forget(id);
    }

    for (const [id, verdict] of diff.verdicts) {
      const prior = this.states.get(id);
      const idle: NodeState = {
        status: 'idle',
        ports: {},
        persist: this.persistEnabled(id),
      };
      if (verdict === 'preserve' && prior) {
        this.states.set(id, { ...prior, persist: idle.persist });
      } else if (verdict === 'stale' && prior) {
        this.states.set(id, {
          ...prior,
          status: 'stale',
          persist: idle.persist,
        });
      } else {
        dropStore(id);
        this.states.set(id, idle);
      }
    }

    // Drop caches BEFORE the background hydrate runs — otherwise a reset
    // node (now `idle`) would be restored from its outdated cache.
    await Promise.all(
      diff.cachesToDrop.map(id =>
        fs.rm(this.cachePath(id)).catch(() => {
          /* no cache file — fine */
        })
      )
    );
  }

  /**
   * Restore persisted nodes from disk in the background. Returns the in-flight
   * promise; idempotent. Long-lived frontends call this after wiring listeners
   * so the editor sees each node light up. The headless one-shot skips it (its
   * `runOne` fast-path covers the target's path). Tests await the promise (or
   * `whenHydrated()`).
   */
  hydrate(): Promise<void> {
    return this.hydration.hydrate();
  }

  /** Resolves when the current background hydration (if any) has finished. */
  whenHydrated(): Promise<void> {
    return this.hydration.whenHydrated();
  }

  /** Summarise a port without returning bulk data. Bounded by schema width
   *  + `limit`, never row count. See introspect.ts. */
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

  /** All transitive upstream of `id`, plus `id`, in process order. */
  private plan(id: string): string[] {
    return topoSort(this.edges, [id]);
  }

  private downstream(id: string): string[] {
    return transitiveDownstream(this.edges, id);
  }

  // --- input resolution ---------------------------------------------------

  /**
   * Resolve a node's `in:` ports: literal values merged with data pulled
   * across edges. Multi-edge rule: collect, drop `undefined`, then
   * `length===1 ? values[0] : values.flat()`. The depth-1 flatten makes two
   * array-producing edges into one `data` port concatenate (not nest), and
   * passes through a lone producer's value (array or scalar) untouched.
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
   * Backing impl of `ctx.resolvePath`. `path.resolve` against the flow dir;
   * a leading `~` in the first segment expands to `$HOME`; no args ⇒ the
   * flow dir itself. See contract.ts.
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
   * Backing impl of `ctx.processTemporaryNode`. Runs `nodeType` as a sub-node
   * with explicit inputs, capturing outputs into the caller's object.
   *
   * `callerId` is the composing node — kept stable through nesting so the
   * self-composite guard, `nodeId`, and `resolvePath` always reflect the
   * original node. The sub-node has no graph identity, so `controls` is
   * empty (it reads its config from `inputs`).
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

    yield* node.process(tempCtx);
  }

  private persistEnabled(id: string) {
    const override = this.persistOverride.get(id);
    if (override !== undefined) return override;
    return this.file.nodes[id]?.persist === true;
  }

  /** Every node, upstream before downstream. */
  private topoOrder(): string[] {
    return topoSort(this.edges, Object.keys(this.file.nodes));
  }

  private outputsOf(id: string): Record<string, unknown> {
    return portMap(this.store, id);
  }

  /**
   * Toggle disk-persistence for one node — session-only, never written to
   * YAML. Enabling with output already present writes the cache immediately
   * (so the toggle is felt without a re-run). Disabling drops the cache file
   * but leaves the live output intact (use `invalidate` to clear that too).
   */
  async setPersist(id: string, value: boolean) {
    if (!this.file.nodes[id]) return;
    this.persistOverride.set(id, value);
    this.set(id, { persist: value });
    if (value) {
      if (this.hasOutputs(id)) {
        await writePersistedCache(this.cachePath(id), this.outputsOf(id));
      }
    } else {
      try {
        await fs.rm(this.cachePath(id));
      } catch {
        /* no cache file — fine */
      }
    }
  }

  // --- steering controls --------------------------------------------------

  /** Lazy — `undefined` until the type has resolved at least once. */
  private controlSchemaOf(
    id: string
  ): Record<string, ControlSchema> | undefined {
    return this.resolver.peek(this.file.nodes[id]?.type)?.controls;
  }

  /** File whose `hook` export the HTTP seam bundles. `undefined` until the
   *  type has resolved and a `hook` export was seen. */
  controlHookFile(type: string | undefined): string | undefined {
    if (this.resolver.peekHookMtime(type) === undefined) return undefined;
    return this.resolver.peekFile(type);
  }

  /**
   * File backing a resolved type. Exposed so the agent can read a node's
   * source — the only way to discover a free-form control's form field
   * `name`s, since the form HTML is built by the node module itself.
   * Lazy: `undefined` until the type has resolved.
   */
  moduleFile(type: string | undefined): string | undefined {
    return this.resolver.peekFile(type);
  }

  /** Runtime overlay merged over schema defaults. */
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

  /** The `{controls, controlState}` slice. `{}` when the node declares no
   *  controls or its module hasn't resolved yet. */
  private controlPatch(id: string): Partial<NodeState> {
    const schema = this.controlSchemaOf(id);
    if (!schema || !Object.keys(schema).length) return {};
    return { controls: schema, controlState: this.effectiveControls(id, schema) };
  }

  /**
   * Set one steering value. Validates against the schema (unknown node/key,
   * wrong shape, or unresolved schema is a silent no-op) and records the
   * value in the session overlay. Ages the node + downstream `stale` —
   * never re-runs, the user pulls.
   */
  async setControl(id: string, key: string, value: unknown) {
    if (!this.file.nodes[id]) return;
    const cs = this.controlSchemaOf(id)?.[key];
    if (!cs || !controlValid(cs, value)) return;
    const cur = this.controlOverride.get(id) ?? {};
    this.controlOverride.set(id, { ...cur, [key]: value });
    await this.markStale(id);
    for (const d of this.downstream(id)) await this.markStale(d);
    this.set(id, this.controlPatch(id));
  }

  // --- free-form controls (LiveView model) --------------------------------

  /** The node's own written output ports (`{}` before first pull). Frozen
   *  between pulls — the pull-graph snapshot, kept across `stale`. */
  private nodeOutputs(id: string): Record<string, unknown> {
    return portMap(this.store, id);
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
   * Derive a free-form control's streamed state: `data` → `render` per
   * surface → inert HTML. Presentation only; never re-runs `process`. Called
   * after a pull and after every control event.
   */
  private async controlStatePatch(id: string): Promise<Partial<NodeState>> {
    const type = this.file.nodes[id]?.type;
    // `peek` (cache-only, sync) is correct because every caller — `runOne`
    // and `controlEvent` — has just `resolve`d the type, so modCache holds
    // the freshest module. Adding a `resolve()` here would perturb the
    // foreground-vs-hydrate race that other paths rely on.
    const ctl = this.resolver.peek(type)?.control;
    if (!ctl?.render) return {};
    const hookMtime = this.resolver.peekHookMtime(type);
    let data: unknown;
    try {
      data = ctl.data ? await ctl.data(this.controlCtx(id)) : undefined;
    } catch (err) {
      this.set(id, {});
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
    // Wire-side dedupe: omit `controlWindowHtml` when `render` doesn't
    // branch on surface (the common case). Editor falls back to
    // `controlHtml` when the window field is undefined.
    const inlineHtml = render('node');
    const windowHtml = render('window');
    return {
      controlHtml: inlineHtml,
      ...(windowHtml === inlineHtml ? {} : { controlWindowHtml: windowHtml }),
      controlData: data,
      controlHook:
        hookMtime === undefined ? undefined : { mtimeMs: hookMtime },
      controlWindow: ctl.window,
    };
  }

  /**
   * Handle a control event. Handler throws are logged, never rethrown — the
   * *event* failed, the node is still done/stale. `$mount` skips the handler
   * (the shim fires it when a surface appears) and just re-derives + streams.
   * A handler may `ctx.markStale()` to signal its writes outdated the node's
   * output. No rerun: the control stays live by re-deriving via `data`.
   */
  async controlEvent(id: string, event: string, payload?: unknown) {
    const def = this.file.nodes[id];
    if (!def) return;
    // Mtime-aware resolve so a control-code edit is live on the next event.
    // Falls back to the cached module on a transient broken edit.
    const r = await this.resolver.resolve(def.type);
    if (r.error) console.error(`[${id}] control resolve: ${r.error}`);
    const ctl = r.node?.control ?? this.resolver.peek(def.type)?.control;
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
      await this.markStale(id);
      for (const d of this.downstream(id)) await this.markStale(d);
    }
    this.set(id, await this.controlStatePatch(id));
  }

  /**
   * Seed (and override) output ports from the node def's `out:` literals.
   * Returns the seeded entries so callers can fold them into port stats /
   * cache. Example: `out: { src: 'plot.png' }` puts `"plot.png"` on `src`.
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
   * Process `id` and its transitive upstream. Plans run in parallel (frontier
   * scheduler) and may overlap freely — per-node `inFlightRuns` dedupe makes
   * a shared upstream safe across overlapping plans.
   *
   * Stale upstream is reused by default: a `stale` node's kept-amber output
   * is fed downstream, and the resulting node finishes `stale` itself (a
   * node derived from stale data is not honestly `done`). `rerunStale: true`
   * forces every stale upstream to recompute.
   */
  process(
    targetId: string,
    opts: { rerunStale?: boolean } = {}
  ): Promise<void> {
    return this.runPlan(targetId, opts);
  }

  private async runPlan(
    targetId: string,
    opts: { rerunStale?: boolean } = {}
  ): Promise<void> {
    const rerunStale = opts.rerunStale === true;
    // "Run to here" makes the target the fresh frontier: anything strictly
    // downstream was computed from its old output, so age it stale.
    for (const d of this.downstream(targetId)) await this.markStale(d);

    // The target ALWAYS runs (a user click on a green node expects work);
    // only transitive upstream is memoise-eligible. Persist fast-path in
    // `runOne` still applies — "persist" means "serve cached" by intent.
    const order = this.plan(targetId);
    const toRun = new Set<string>();
    for (const id of order) {
      const st = this.states.get(id);
      if (id !== targetId && st?.status === 'done' && this.hasOutputs(id))
        continue;
      if (
        id !== targetId &&
        !rerunStale &&
        st?.status === 'stale' &&
        this.hasOutputs(id)
      )
        continue;
      toRun.add(id);
      // Don't clobber a node already queued/running — an overlapping plan
      // may have it in flight; downgrading `running→queued` mis-paints it.
      if (st && st.status !== 'queued' && st.status !== 'running')
        this.set(id, {
          status: 'queued',
          error: undefined,
          errorStack: undefined,
          inputDigest: undefined,
          errorAt: undefined,
        });
    }

    // Frontier scheduler: each iteration promotes every ready node, fires
    // them in parallel, then races their completion before re-evaluating.
    // Diamond A → {B,C} → D: B and C run in parallel after A; D fires when
    // both have produced outputs.
    const failed = new Set<string>();
    const active = new Map<string, Promise<void>>();
    const pending = new Set(toRun);

    type Readiness =
      | { kind: 'ready' }
      | { kind: 'wait' }
      | { kind: 'blocked'; blockers: string[] };
    const classify = (id: string): Readiness => {
      const blockers: string[] = [];
      let waiting = false;
      for (const e of this.edges) {
        if (e.to !== id) continue;
        if (failed.has(e.from)) blockers.push(e.from);
        else if (pending.has(e.from) || active.has(e.from)) waiting = true;
        else if (!this.hasOutputs(e.from)) blockers.push(e.from);
      }
      if (blockers.length) return { kind: 'blocked', blockers };
      if (waiting) return { kind: 'wait' };
      return { kind: 'ready' };
    };

    const fireBlocked = (id: string, blockers: string[]) => {
      failed.add(id);
      pending.delete(id);
      this.set(id, {
        status: 'error',
        error: `Blocked — upstream ${[...new Set(blockers)]
          .map(b => `"${b}"`)
          .join(', ')} failed`,
        summary: undefined,
        progress: undefined,
        // A block is not a throw; clear any diagnostics from a prior failure.
        errorStack: undefined,
        inputDigest: undefined,
        errorAt: undefined,
        ports: {},
      });
    };

    while (pending.size > 0 || active.size > 0) {
      // Iterate a snapshot so `pending.delete` doesn't trip the iterator.
      for (const id of [...pending]) {
        const r = classify(id);
        if (r.kind === 'blocked') {
          fireBlocked(id, r.blockers);
        } else if (r.kind === 'ready') {
          pending.delete(id);
          const p = this.runOne(id).finally(() => {
            active.delete(id);
            if (this.states.get(id)?.status === 'error') failed.add(id);
          });
          active.set(id, p);
        }
      }

      if (pending.size === 0 && active.size === 0) break;

      if (active.size === 0) {
        // Pending with nothing in flight and nothing classifiable as
        // ready/blocked: a dependency cycle slipped past `plan()`. Surface
        // remaining nodes as errored rather than spin forever.
        for (const id of [...pending]) {
          failed.add(id);
          pending.delete(id);
          this.set(id, {
            status: 'error',
            error: 'Plan deadlocked — dependency cycle or missing upstream',
            summary: undefined,
            progress: undefined,
            errorStack: undefined,
            inputDigest: undefined,
            errorAt: undefined,
            ports: {},
          });
        }
        break;
      }

      // `runOne` folds errors into node state — never rejects — so race
      // is safe without an extra catch.
      await Promise.race(active.values());
    }

    // `cocoon run` exits non-zero only when the requested target itself
    // failed; unrelated branches don't count.
    if (failed.has(targetId)) {
      throw new Error(
        `Cannot process "${targetId}": ${
          this.states.get(targetId)?.error ?? 'upstream failure'
        }`
      );
    }
  }

  /** Drop output + cache so the next process re-runs the node. */
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
   * Age a `done` node to `stale`. The in-memory output is kept (visible,
   * amber, "click to re-run"). The persist cache is dropped — a `stale`
   * node must not be memoised, and `hydrate` would otherwise resurrect it
   * as `done` from the outdated cache.
   */
  private async markStale(id: string) {
    if (this.states.get(id)?.status !== 'done') return;
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
    return storeHasOutputs(this.store, id);
  }

  /** Per-node dedupe across overlapping plans. `doRunOne` never rejects —
   *  errors land on node state, observed via `states.get(id).status`. */
  private runOne(id: string): Promise<void> {
    const existing = this.inFlightRuns.get(id);
    if (existing) return existing;
    const p = this.doRunOne(id).finally(() => this.inFlightRuns.delete(id));
    this.inFlightRuns.set(id, p);
    return p;
  }

  private async doRunOne(id: string): Promise<void> {
    const def = this.file.nodes[id];
    const { node, error: resolveError } = await this.resolver.resolve(
      def?.type
    );
    if (!node) {
      // Record import failures by type so the AI digest surfaces them.
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

    // Persist fast-path: serve from disk instead of recomputing. Background
    // `hydrate` usually wins this race; this covers nodes the hydration
    // stream hadn't reached yet, or caches that appeared after load.
    if (this.persistEnabled(id) && (await this.hydration.restore(id))) return;

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
      controls: {
        read: () =>
          node.controls ? this.effectiveControls(id, node.controls) : {},
      },
    };

    try {
      // Guarded: an `uncaughtException`/`unhandledRejection` from the node's
      // async I/O (e.g. pg's socket handler) is rerouted here as a rejection
      // instead of killing the core. See node-guard.ts.
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

        // Static `out:` literals seed (and override) written ports.
        Object.assign(written, this.seedStaticOut(id));

        const ports: Record<string, number> = {};
        for (const [p, v] of Object.entries(written)) ports[p] = itemCount(v);

        // Stale propagation: a direct upstream still `stale` means our
        // output is derivative-of-stale. Finish `stale` so we never present
        // it as fresh — and do NOT write the persist cache (stale is not
        // memoised, matching `markStale`).
        let staleInput = false;
        for (const e of this.edges)
          if (e.to === id && this.states.get(e.from)?.status === 'stale') {
            staleInput = true;
            break;
          }
        const finalStatus: NodeState['status'] = staleInput ? 'stale' : 'done';

        if (this.persistEnabled(id) && finalStatus === 'done') {
          await writePersistedCache(this.cachePath(id), written);
        }

        this.set(id, {
          status: finalStatus,
          summary: summary || 'Processed',
          ports,
          progress: undefined,
          ...this.controlPatch(id),
        });
        // Async derive (data half may read the file), so a separate set.
        this.set(id, await this.controlStatePatch(id));

        // A re-run ages downstream (no-op if they weren't `done`).
        for (const d of this.downstream(id)) await this.markStale(d);
      });
    } catch (err) {
      // Never rethrow: a throw here would abort the plan loop and strand
      // every later-planned node in `queued`. Failures are reported via
      // node state; the scheduler treats dependents as blocked.
      //
      // Diagnostics: stack, a bounded digest of resolved inputs, and (when
      // a per-item node attached it) the offending `cocoonErrorAt` slice.
      // Best-effort — error reporting must not itself throw.
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

  /** Read a port's raw data; used by headless run for stdout output. */
  readPort(uri: string): unknown {
    const parsed = parseCocoonUri(uri);
    if (!parsed) throw new Error(`Not a cocoon:// uri: ${uri}`);
    return this.store.get(`${parsed.id}/${parsed.port.name}`);
  }
}
