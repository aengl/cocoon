/**
 * Background restore of persisted nodes (the `_cocoon_cache/<id>.json` files
 * `writePersistedCache` wrote). Extracted because the progress throttling,
 * the ENOENT-vs-real-error logging, the optimistic-running undo, and the
 * cross-caller dedupe with `runOne`'s persist fast-path are all internal
 * concerns — the runtime only needs `hydrate()` / `whenHydrated()` /
 * `restore(id)` / `forget(id)`.
 */
import { readPersistedCache } from './persist-cache.ts';
import { dedupePerKey } from './dedupe-per-key.ts';
import type { NodeState, NodeStatus } from '../src/lib/protocol.ts';

const itemCount = (v: unknown) =>
  Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1;

export interface HydrationDeps {
  cachePath(id: string): string;
  hasNode(id: string): boolean;
  /** The runtime's current generation. A late-finishing restore observing a
   *  stale generation must NOT write into the moved-on graph. */
  generation(): number;
  getStatus(id: string): NodeStatus | undefined;
  setState(id: string, patch: Partial<NodeState>): void;
  setStore(id: string, port: string, value: unknown): void;
  seedStaticOut(id: string): Record<string, unknown>;
  controlPatch(id: string): Partial<NodeState>;
  controlStatePatch(id: string): Promise<Partial<NodeState>>;
  topoOrder(): string[];
  persistEnabled(id: string): boolean;
}

export class Hydration {
  /** Concurrent-restore dedupe: hydrate and runOne's fast-path can both want
   *  the same node; a multi-hundred-MiB cache must not be parsed twice. */
  private inFlight = new Map<string, Promise<boolean>>();
  /** Bookkeeping for `whenHydrated()`. Always resolved between hydrate calls. */
  private current: Promise<void> = Promise.resolve();
  private deps: HydrationDeps;

  constructor(deps: HydrationDeps) {
    this.deps = deps;
  }

  /**
   * Restore every persisted node from its cache. Sequential (one large cache
   * is already heap-heavy; parallel parses risk OOM) and in topological order
   * (so a node's upstream is seeded when its own cache lands, letting a
   * downstream re-pull memoise it). Skips nodes no longer `idle`. Bails once
   * a newer generation supersedes us.
   */
  hydrate(): Promise<void> {
    const gen = this.deps.generation();
    this.current = this.run(gen);
    return this.current;
  }

  whenHydrated(): Promise<void> {
    return this.current;
  }

  forget(id: string): void {
    this.inFlight.delete(id);
  }

  private async run(gen: number): Promise<void> {
    for (const id of this.deps.topoOrder()) {
      if (gen !== this.deps.generation()) return;
      if (
        this.deps.persistEnabled(id) &&
        this.deps.getStatus(id) === 'idle'
      )
        await this.restore(id, gen);
    }
  }

  /**
   * Restore one node. De-dupes concurrent callers (hydrate + runOne's
   * fast-path). `gen` is the caller's observed generation — a result parsed
   * under a stale generation is discarded, not resurrected.
   */
  restore(id: string, gen: number = this.deps.generation()): Promise<boolean> {
    return dedupePerKey(this.inFlight, id, () => this.doRestore(id, gen));
  }

  private async doRestore(id: string, gen: number): Promise<boolean> {
    // Only flip the status when WE own the lifecycle (prior was `idle` — the
    // hydrate case). The `runOne` fast-path already set `running` itself; we
    // still feed it byte progress below but don't touch its terminal state.
    const tookRunning =
      gen === this.deps.generation() &&
      this.deps.hasNode(id) &&
      this.deps.getStatus(id) === 'idle';
    if (tookRunning)
      this.deps.setState(id, {
        status: 'running',
        progress: 'Restoring from cache…',
        summary: undefined,
        error: undefined,
        errorStack: undefined,
      });
    let lastEmit = 0;
    const onBytes = (total: number) => {
      if (gen !== this.deps.generation()) return;
      const now = Date.now();
      if (now - lastEmit < 150) return;
      lastEmit = now;
      this.deps.setState(id, {
        status: 'running',
        progress: `Restoring from cache… ${(total / 1048576).toFixed(1)} MB`,
      });
    };
    try {
      const cached = await readPersistedCache(
        this.deps.cachePath(id),
        onBytes
      );
      // A reload cleared the store / dropped this node while we streamed —
      // don't write into a graph that has moved on.
      if (gen !== this.deps.generation() || !this.deps.hasNode(id))
        return false;
      const ports: Record<string, number> = {};
      for (const [p, v] of Object.entries(cached)) {
        this.deps.setStore(id, p, v);
        ports[p] = itemCount(v);
      }
      // Re-seed static `out:` literals so a downstream reader still resolves.
      for (const [p, v] of Object.entries(this.deps.seedStaticOut(id)))
        ports[p] = itemCount(v);
      this.deps.setState(id, {
        status: 'done',
        summary: `Restored from cache (${Object.entries(ports)
          .map(([p, n]) => `${p}: ${n}`)
          .join(', ')})`,
        ports,
        progress: undefined,
        ...this.deps.controlPatch(id),
      });
      this.deps.setState(id, await this.deps.controlStatePatch(id));
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
      // Undo only OUR optimistic `running` flip. A `runOne` fast-path's own
      // `running` (tookRunning === false) is left for it to resolve.
      if (
        tookRunning &&
        gen === this.deps.generation() &&
        this.deps.getStatus(id) === 'running'
      )
        this.deps.setState(id, { status: 'idle', progress: undefined });
      return false;
    }
  }
}
