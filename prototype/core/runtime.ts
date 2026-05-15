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
import { parseCocoonUri, parseViewString } from '../src/lib/cocoon-uri.ts';
import type { NodeState } from '../src/lib/protocol.ts';
import { views } from '../src/lib/views/index.ts';
import type { Registry } from './contract.ts';
import { loadProjectNodes } from './load-nodes.ts';
import { registry as defaultRegistry } from './nodes/index.ts';

const itemCount = (v: unknown) =>
  Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1;

export type StateListener = (id: string, state: NodeState) => void;

export class Runtime {
  readonly filePath: string;
  yaml: string;
  file!: CocoonFile;
  edges: CocoonEdge[] = [];

  private registry: Registry;
  /** `${nodeId}/${port}` -> data. The single source of truth for port data. */
  private store = new Map<string, unknown>();
  private states = new Map<string, NodeState>();
  private listeners = new Set<StateListener>();
  /** Live persist toggles from the editor. Never written back to YAML. */
  private persistOverride = new Map<string, boolean>();
  /** Custom-node modules that failed to import (`spec -> reason`). */
  private nodeLoadErrors = new Map<string, string>();

  private constructor(filePath: string, yaml: string, registry: Registry) {
    this.filePath = filePath;
    this.yaml = yaml;
    this.registry = registry;
  }

  static async load(filePath: string, base: Registry = defaultRegistry) {
    const abs = path.resolve(filePath);
    const [yaml, loaded] = await Promise.all([
      fs.readFile(abs, 'utf8'),
      loadProjectNodes(abs, base),
    ]);
    const rt = new Runtime(abs, yaml, loaded.registry);
    rt.nodeLoadErrors = loaded.errors;
    rt.file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!rt.file.nodes) rt.file.nodes = {};
    rt.edges = extractEdges(rt.file);
    for (const id of Object.keys(rt.file.nodes)) {
      rt.states.set(id, {
        status: 'idle',
        ports: {},
        persist: rt.persistEnabled(id),
      });
    }
    return rt;
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
   * param value(s) merged with data pulled across connected edges. Mirrors
   * legacy port reading; multiple values on one port collapse to an array.
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
      inputs[port] = values.length <= 1 ? values[0] : values;
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
        const written = this.outputsOf(id);
        await fs.mkdir(path.dirname(this.cachePath(id)), { recursive: true });
        await fs.writeFile(this.cachePath(id), JSON.stringify(written));
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
    // A view bound to an *input* port (`in/<port>/<Type>`) must show what the
    // node reads there — resolved exactly as the node does (literal params +
    // data pulled across edges), never the node's own like-named output.
    const data = port?.incoming
      ? this.resolveInputs(id)[port.name]
      : this.store.get(`${id}/${port?.name ?? 'data'}`);
    const arr = Array.isArray(data) ? data : data === undefined ? [] : [data];
    try {
      return view.serialiseViewData(arr, (def.viewState ?? {}) as never);
    } catch (err) {
      console.error(`[${id}] view "${type}" serialise failed:`, err);
      return undefined;
    }
  }

  // --- processing ---------------------------------------------------------

  /** Process `id` and everything it depends on; memoised + persist-aware. */
  async process(targetId: string): Promise<void> {
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
        this.set(id, { status: 'queued', error: undefined });
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

    this.set(id, { status: 'running', error: undefined, progress: undefined });

    // Engine-level persist: serve from disk cache instead of processing.
    if (this.persistEnabled(id)) {
      try {
        const cached = JSON.parse(
          await fs.readFile(this.cachePath(id), 'utf8')
        ) as Record<string, unknown>;
        const ports: Record<string, number> = {};
        for (const [p, v] of Object.entries(cached)) {
          this.store.set(`${id}/${p}`, v);
          ports[p] = itemCount(v);
        }
        this.set(id, {
          status: 'done',
          summary: `Restored from cache (${Object.entries(ports)
            .map(([p, n]) => `${p}: ${n}`)
            .join(', ')})`,
          ports,
          progress: undefined,
          viewData: this.computeViewData(id),
        });
        return;
      } catch {
        /* no/invalid cache — process normally */
      }
    }

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

      const ports: Record<string, number> = {};
      for (const [p, v] of Object.entries(written)) ports[p] = itemCount(v);

      if (this.persistEnabled(id)) {
        await fs.mkdir(path.dirname(this.cachePath(id)), { recursive: true });
        await fs.writeFile(this.cachePath(id), JSON.stringify(written));
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
    } catch (err) {
      // Record the failure and return — never rethrow. A thrown error here
      // would abort the whole plan loop and strand every later-planned node
      // in `queued` forever. The plan (process) decides what a failure means
      // for the rest of the graph: dependents are *blocked*, not limbo.
      this.set(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
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
