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

  private constructor(filePath: string, yaml: string, registry: Registry) {
    this.filePath = filePath;
    this.yaml = yaml;
    this.registry = registry;
  }

  static async load(filePath: string, registry: Registry = defaultRegistry) {
    const abs = path.resolve(filePath);
    const yaml = await fs.readFile(abs, 'utf8');
    const rt = new Runtime(abs, yaml, registry);
    rt.file = (parse(yaml) ?? { nodes: {} }) as CocoonFile;
    if (!rt.file.nodes) rt.file.nodes = {};
    rt.edges = extractEdges(rt.file);
    for (const id of Object.keys(rt.file.nodes)) {
      rt.states.set(id, { status: 'idle', ports: {} });
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
    const def = this.file.nodes[id];
    return (
      def?.persist === true ||
      (def?.persist === undefined &&
        this.registry[def?.type]?.persist === true)
    );
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
    const data = this.store.get(`${id}/${port?.name ?? 'data'}`);
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
    const order = this.plan(targetId);
    for (const id of order) {
      const st = this.states.get(id);
      if (st && (st.status === 'done') && this.hasOutputs(id)) continue;
      if (st && st.status !== 'queued')
        this.set(id, { status: 'queued', error: undefined });
    }
    for (const id of order) {
      const st = this.states.get(id)!;
      if (st.status === 'done' && this.hasOutputs(id)) continue;
      await this.runOne(id);
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
    this.set(id, { status: 'idle', summary: undefined, ports: {} });
  }

  private hasOutputs(id: string) {
    for (const key of this.store.keys()) if (key.startsWith(`${id}/`)) return true;
    return false;
  }

  private async runOne(id: string): Promise<void> {
    const def = this.file.nodes[id];
    const node = this.registry[def?.type];
    if (!node) {
      this.set(id, {
        status: 'error',
        error: `Unknown node type "${def?.type}"`,
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

      // A re-run invalidates anything computed from this node.
      for (const d of this.downstream(id))
        if (this.states.get(d)?.status === 'done')
          this.set(d, { status: 'stale' });
    } catch (err) {
      this.set(id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        progress: undefined,
      });
      throw err;
    }
  }

  /** Read a port's data by `cocoon://id/out/port` — used by headless run. */
  readPort(uri: string): unknown {
    const parsed = parseCocoonUri(uri);
    if (!parsed) throw new Error(`Not a cocoon:// uri: ${uri}`);
    return this.store.get(`${parsed.id}/${parsed.port.name}`);
  }
}
