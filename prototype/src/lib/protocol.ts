/**
 * The entire editor <-> core wire protocol. Deliberately tiny: legacy Cocoon
 * hand-rolled dozens of IPC message types; the revival collapses that to one
 * graph push + one node-state stream + one command. WebSocket (not SSE)
 * because brushing & linking (deferred) is inherently bidirectional and lives
 * in exactly this layer.
 *
 * Shared by both sides. The browser imports it as a normal module; the Node
 * core imports it type-only (`import type`), so nothing is bundled either way.
 */

/** The lifecycle a node moves through, surfaced as colour in the editor. */
export type NodeStatus =
  | 'idle' // never run
  | 'queued' // scheduled as part of a process plan
  | 'running' // process() generator is executing
  | 'done' // processed, port data valid
  | 'stale' // was done; an input changed (upstream re-ran / ran to an earlier node) — kept visible, not recomputed
  | 'error'; // process() threw

export interface NodeState {
  status: NodeStatus;
  /** The string a node's process() generator returns ("Imported 1243 items"). */
  summary?: string;
  /** Latest yield from the generator (string or 0..1 progress). */
  progress?: string | number;
  error?: string;
  /**
   * Throwing location for an `error`. Legacy/early-revival kept only
   * `err.message` (a documented diagnostics gap); surfaced now because the
   * AI debug loop needs *where* it threw, not just what.
   */
  errorStack?: string;
  /**
   * Schema-shaped digest of the node's resolved inputs at throw time — the
   * node-agnostic "what was actually fed in" view. Bounded by construction
   * (see core/introspect.ts `digest`); never bulk data.
   */
  inputDigest?: unknown;
  /**
   * Exact failing item for the core-owned per-item nodes (`Map`/`Filter`):
   * the index and a digested record. Absent for arbitrary custom nodes
   * (true per-record attribution there needs a node-author API change).
   */
  errorAt?: { index: number; record: unknown };
  /** Per-output-port item count -> drawn as the edge label. */
  ports: Record<string, number>;
  /**
   * Effective persist state (YAML default OR a live runtime override toggled
   * from the editor). Streamed so the editor's persist/trash actions reflect
   * the *processing instance* — the source of truth — not the static file.
   */
  persist?: boolean;
  /**
   * Result of the attached view's `serialiseViewData` (run in the core, so
   * only this reduced slice crosses the wire — never the bulk port data).
   * `null` = view produced nothing; absent = node has no view / not run.
   */
  viewData?: unknown;
}

/**
 * A read-only introspection request. One correlated request/response pair
 * carries every variant (the variation is in `kind`, NOT on the wire) so the
 * "one graph push + one state stream + commands" minimalism holds — legacy's
 * dozens of IPC types are not reintroduced. Drives the AI debug loop; the
 * editor may use the same channel. The core owns all port data, so even
 * `peek` returns a bounded digest, never bulk rows.
 */
export type Query =
  /** File/env, node+edge counts, status & type breakdown, load failures. */
  | { kind: 'overview' }
  /** One node: digested params, in/out edges, up/down counts, state. */
  | { kind: 'node'; id: string }
  /** Transitive upstream/downstream as `{id,type,status}` (optional depth). */
  | { kind: 'upstream' | 'downstream'; id: string; depth?: number }
  /**
   * A port's data, summarised in-core: row count, per-key
   * type/presence/example, JSON-string `descend`, plus a bounded
   * `where`/`select`/`limit` slice (predicate cast like `Filter`'s).
   */
  | {
      kind: 'peek';
      uri: string;
      descend?: string;
      where?: string;
      select?: string[];
      limit?: number;
    };

/** Browser/AI -> core. */
export type ClientMessage =
  /** Process this node and everything upstream it depends on. */
  | { t: 'process'; node: string }
  /** Drop a node's cached output (and persisted cache), forcing a re-run. */
  | { t: 'invalidate'; node: string }
  /**
   * Toggle disk-persistence for a node at runtime. A *session* override (the
   * editor never churns the hand-edited YAML — see the lossless contract); it
   * lives on the processing instance, which is the source of truth.
   */
  | { t: 'setPersist'; node: string; value: boolean }
  /**
   * Re-read the YAML after the flow was edited on disk (the AI builds/wires a
   * node, then reloads). Full reset: store cleared, all nodes idle; persisted
   * nodes restore from disk cache on next process. The core re-broadcasts
   * `graph` + a fresh state snapshot so every client (editor included)
   * repaints — "fix it, watch it light up".
   */
  | { t: 'reload' }
  /** Correlated read-only introspection request; reply is `queryResult`. */
  | { t: 'query'; rid: string; q: Query };

/** Core -> browser. */
export type ServerMessage =
  /** Sent once on connect: identifies the loaded file. */
  | { t: 'hello'; file: string }
  /** The Cocoon definition file, verbatim. The editor runs its own lossless
   *  loader on this — the core never re-serialises YAML. */
  | { t: 'graph'; yaml: string }
  /** A single node's state changed. Streamed; never carries bulk data. */
  | { t: 'node'; id: string; state: NodeState }
  /** Reply to a `query`, correlated by `rid`. `data` is always bounded. */
  | { t: 'queryResult'; rid: string; ok: boolean; data?: unknown; error?: string };
