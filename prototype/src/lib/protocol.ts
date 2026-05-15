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
  | 'stale' // was done, but an upstream node re-ran since
  | 'error'; // process() threw

export interface NodeState {
  status: NodeStatus;
  /** The string a node's process() generator returns ("Imported 1243 items"). */
  summary?: string;
  /** Latest yield from the generator (string or 0..1 progress). */
  progress?: string | number;
  error?: string;
  /** Per-output-port item count -> drawn as the edge label. */
  ports: Record<string, number>;
  /**
   * Result of the attached view's `serialiseViewData` (run in the core, so
   * only this reduced slice crosses the wire — never the bulk port data).
   * `null` = view produced nothing; absent = node has no view / not run.
   */
  viewData?: unknown;
}

/** Browser -> core. */
export type ClientMessage =
  /** Process this node and everything upstream it depends on. */
  | { t: 'process'; node: string }
  /** Drop a node's cached output (and persisted cache), forcing a re-run. */
  | { t: 'invalidate'; node: string };

/** Core -> browser. */
export type ServerMessage =
  /** Sent once on connect: identifies the loaded file. */
  | { t: 'hello'; file: string }
  /** The Cocoon definition file, verbatim. The editor runs its own lossless
   *  loader on this — the core never re-serialises YAML. */
  | { t: 'graph'; yaml: string }
  /** A single node's state changed. Streamed; never carries bulk data. */
  | { t: 'node'; id: string; state: NodeState };
