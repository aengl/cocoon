/**
 * The entire editor ↔ core wire protocol: one graph push, one node-state
 * stream, one command channel, plus an opaque presence side-channel.
 *
 * Shared by both sides. The browser imports it as a normal module; the Node
 * core imports it type-only so nothing is bundled either way.
 */

/** The lifecycle a node moves through, surfaced as colour in the editor. */
export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'done'
  /** Was done; an input changed. Kept visible, not auto-recomputed. */
  | 'stale'
  | 'error';

/**
 * A code-declared steering knob. The schema lives in node code (the one
 * deliberate registry-free exception); the value is a runtime overlay
 * (`controlState`) like `persist`, never written to YAML.
 */
export type ControlSchema =
  | { kind: 'toggle'; label?: string; default?: boolean }
  | { kind: 'select'; label?: string; options: string[]; default?: string }
  | {
      kind: 'text';
      label?: string;
      default?: string;
      placeholder?: string;
      multiline?: boolean;
    }
  | {
      kind: 'number';
      label?: string;
      default?: number;
      min?: number;
      max?: number;
      step?: number;
    };

/**
 * The browser render hook a node exports — the LiveView `phx-hook` analogue
 * and the only render contract in Cocoon. Framework-agnostic and depends on
 * nothing; the core never evaluates it (its browser-only deps stay out of the
 * Node side). The core esbuild-bundles the `hook` export and serves it at
 * `GET /hook/<type>?m=<mtime>`; the editor dynamic-imports by node-type
 * convention.
 *
 * `props.data` is the node's `controlData` payload; it changes data-only (no
 * HTML churn), so a hook updates in place rather than being torn down.
 */
export interface ControlHookProps<Data = unknown> {
  data: Data;
}

export interface ControlHookInstance<Data = unknown> {
  update(props: ControlHookProps<Data>): void;
  destroy(): void;
}

export interface ControlHook<Data = unknown> {
  mount(
    el: HTMLElement,
    props: ControlHookProps<Data>
  ): ControlHookInstance<Data>;
}

export interface NodeState {
  status: NodeStatus;
  /** The string a node's process() generator returns ("Imported 1243 items"). */
  summary?: string;
  /** Latest yield from the generator (string or 0..1 progress). */
  progress?: string | number;
  error?: string;
  /** Where it threw — needed by the AI debug loop, not just the message. */
  errorStack?: string;
  /**
   * Schema-shaped digest of resolved inputs at throw time — the node-agnostic
   * "what was actually fed in" view. Bounded by construction in
   * core/introspect.ts `digest`; never bulk data.
   */
  inputDigest?: unknown;
  /**
   * Exact failing item for the core-owned per-item nodes (`Map`/`Filter`).
   * Absent for arbitrary custom nodes (per-record attribution there needs a
   * node-author API change).
   */
  errorAt?: { index: number; record: unknown };
  /** Per-output-port item count → drawn as the edge label. */
  ports: Record<string, number>;
  /** Effective persist (YAML default OR a runtime override toggled from the
   *  editor); streamed so the toolbar always reflects the live truth. */
  persist?: boolean;
  /** Code-declared steering controls. Lazy — present once the node's module
   *  has resolved (first run / peek). */
  controls?: Record<string, ControlSchema>;
  /** Effective control values (overlay over schema defaults). Never YAML;
   *  reset on core restart. Keyed by control name. */
  controlState?: Record<string, unknown>;
  /** Server-rendered HTML for the free-form control. Lazy like `controls`;
   *  interactivity rides a generic shim, never node code in the browser. */
  controlHtml?: string;
  /**
   * The same control rendered for the detached window surface.
   *
   * Wire-side dedupe: the core OMITS this field when its bytes would equal
   * `controlHtml` (non-branching renders). Consumers MUST fall back to
   * `controlHtml` when undefined — `controlWindowHtml === undefined` does
   * NOT mean "no window surface"; `controlHtml === undefined` does.
   */
  controlWindowHtml?: string;
  /** The core-computed bounded payload fed to the render hook. The agent
   *  reads this same slice instead of scraping rendered HTML. */
  controlData?: unknown;
  /** Present ⇒ the node's module exports a browser `hook`. `mtimeMs` is the
   *  cache-bust token — the editor imports `/hook/<type>?m=<mtimeMs>`, the
   *  browser twin of the resolver's `?m=<mtime>` hot-reload. */
  controlHook?: { mtimeMs: number };
  /** Code-declared preferred detached-window size in CSS px. Used as the
   *  initial size; a user drag then wins. */
  controlWindow?: { width: number; height: number };
  /** Wall-clock duration of the most recent run (or persist-restore), set on
   *  every terminal transition (`done`/`stale`/`error`). Cleared on entering
   *  `running`. The editor renders it under the status badge; the agent reads
   *  it via `overview` / `upstream` / `node` queries to spot hot nodes. */
  durationMs?: number;
  /** Absolute path of the persist cache that fed this `done`. Present iff the
   *  result was served from disk (either the `runOne` fast-path or background
   *  hydration), absent for a real compute. Lets the agent tell a near-zero
   *  `durationMs` apart from an actually-fast node, and points at the file to
   *  inspect/invalidate. */
  restoredFromCache?: string;
}

/**
 * Client presence — an optional, orthogonal side-channel. Each client (editor
 * tab, agent) MAY announce an opaque blob; the core collects per-connection,
 * rebroadcasts, and interprets nothing. Nothing in processing depends on it.
 * The conventional fields below are client convention (`data` is opaque to
 * the core via `[k:string]:unknown`).
 */
export interface PresenceData {
  label?: string;
  /** Camera + the node ids currently in view. */
  viewport?: { x: number; y: number; zoom: number };
  visibleNodes?: string[];
  /**
   * Node ids the human has selected. Mirror of `callouts` (agent→human is a
   * callout, human→agent is a selection): the agent reads this to resolve
   * "these nodes" without typing ids. Synthetic group artifacts are filtered
   * out client-side.
   */
  selectedNodes?: string[];
  openControls?: string[];
  /** Live, unsaved control input: nodeId → { fieldName → value }. How a
   *  peer/agent reads "what's pasted in the box" without the value ever
   *  being saved. */
  controlDrafts?: Record<string, Record<string, string>>;
  /** Agent→editor: a proposed change-set rendered as a single toast.
   *  Re-announcing the same `id` supersedes (presence is current state,
   *  not an event log). */
  changeSet?: ChangeSet;
  /** Editor→agent: verdicts on change-sets, keyed by id. The agent watches
   *  peer presence for its id, so the core stays a dumb relay. */
  resolvedSuggestions?: { id: string; verdict: SuggestionVerdict }[];
  /**
   * Agent→editor: per-node informational pointers. Fire-and-forget — the
   * editor snapshots a callout on first observation into its own local
   * state, so the marker outlives the agent's disconnect (the only presence
   * consumer that does — every other field evaporates with the socket).
   * Re-announcing the same `id` updates the snapshot and resurrects it if
   * dismissed.
   */
  callouts?: Callout[];
  /** Editor→agent: ids the human has dismissed, purely as a "seen" signal.
   *  Not a verdict — the human's reply belongs in chat. */
  dismissedCallouts?: string[];
  /** Editor→agent: short, chat-friendly labels (`C1`, `C2`, …) for each
   *  observed callout id, in first-seen order. */
  calloutLabels?: Record<string, string>;
  [k: string]: unknown;
}

/** One agent-announced callout — see `PresenceData.callouts` for lifetime. */
export interface Callout {
  /** Stable id chosen by the announcer; re-announce supersedes/resurrects. */
  id: string;
  node: string;
  message: string;
  from?: string;
  tone?: 'info' | 'warn' | 'error';
  /** Announcer timestamp (ms since epoch); the editor falls back to
   *  observation time if absent. Drives the carousel's stable order. */
  ts?: number;
}

export type SuggestionVerdict = 'applied' | 'discarded' | 'stale';

/** A coherent unit of proposed edits — the agent owns batching granularity. */
export interface ChangeSet {
  /** Stable id; re-announce supersedes, peer reports the verdict by this id. */
  id: string;
  from?: string;
  note?: string;
  edits: ChangeEdit[];
}

export interface ChangeEdit {
  node: string;
  /** Target form field — the `name` attribute the shim already submits by. */
  field: string;
  value: string;
  /**
   * What the suggestion was computed against (e.g. the displayed item key).
   * Apply drift-validates against this and self-invalidates if the surface
   * has moved on. Opaque shape; the editor only equality-checks declared
   * keys.
   */
  context?: Record<string, unknown>;
}

/** One peer's presence as the core relays it (connection-keyed). */
export interface PresenceEntry {
  id: string;
  client: string;
  data: PresenceData;
  ts: number;
}

/**
 * A read-only introspection request. One correlated request/response pair
 * carries every variant (variation in `kind`, not on the wire). Drives the AI
 * debug loop; the editor may use the same channel. The core owns all port
 * data, so even `peek` returns a bounded digest, never bulk rows.
 */
export type Query =
  | { kind: 'overview' }
  | { kind: 'node'; id: string }
  /** A node's buffered `ctx.debug()` lines (newest `limit`); ephemeral, reset
   *  on the node's re-run. The diagnostic stream neither side can read off the
   *  core's stdout. */
  | { kind: 'logs'; id: string; limit?: number }
  | { kind: 'upstream' | 'downstream'; id: string; depth?: number }
  | {
      kind: 'peek';
      uri: string;
      descend?: string;
      where?: string;
      select?: string[];
      limit?: number;
      expand?: string[];
    };

/** Browser/AI → core. */
export type ClientMessage =
  /**
   * Process this node and everything upstream it depends on.
   *
   * `rerunStale` recomputes every `stale` upstream; default false reuses
   * stale results (feeds them downstream and lets the target finish `stale`
   * itself). Wired from the toolbar's shift-click / CLI's `--rerun-stale`.
   */
  | { t: 'process'; node: string; rerunStale?: boolean }
  /** Drop a node's cached output and persisted cache, forcing a re-run. */
  | { t: 'invalidate'; node: string }
  /** Toggle disk-persistence at runtime — a session override on the
   *  processing instance; never YAML. */
  | { t: 'setPersist'; node: string; value: boolean }
  /**
   * Set one steering control's value — session override, like `setPersist`.
   * The core marks the node (and downstream) `stale` and re-streams
   * `controlState`; it does NOT pull upstream, re-process, or eager-cascade.
   * Invalid key/value is silently ignored.
   */
  | { t: 'setControl'; node: string; key: string; value: unknown }
  /**
   * A free-form control event from the browser shim or the agent. The
   * node's `control.event` handler changes the durable truth; the core
   * re-derives `controlData` and re-streams the HTML (and, if the handler
   * called `ctx.markStale()`, the `stale` status). Fire-and-forget.
   *
   * The reserved `$mount` fires once per surface mount and skips the
   * handler — it only triggers re-derive + stream, so a freshly opened
   * surface shows its live payload immediately.
   */
  | { t: 'controlEvent'; node: string; event: string; payload?: unknown }
  /**
   * Re-read the YAML from disk. Selective by default — each node keeps its
   * result iff its compute signature and entire transitive upstream are
   * unchanged. `reset:true` is a deliberate full reset (store cleared, all
   * nodes idle, persisted nodes restore from disk), sent only by the
   * toolbar ↻ button.
   */
  | { t: 'reload'; reset?: boolean }
  /**
   * Re-point the running core at a *different* flow file (the editor's
   * path-switch dropdown / `cocoon switch`). `path` is an absolute flow file
   * (or a directory holding `cocoon.yml`/`index.yml`). The core loads a fresh
   * Runtime — all session state from the previous file is dropped — and, on
   * success, broadcasts `switched` + `graph` + a fresh node snapshot to every
   * client. A load/parse failure replies `switched{ok:false}` to the sender
   * only, leaving the current flow untouched.
   */
  | { t: 'switchFile'; path: string }
  /** Announce/replace this client's presence blob. `client` is a self-chosen
   *  display label; `data` is opaque (see `PresenceData`). `data:null`
   *  clears it. */
  | { t: 'presence'; client: string; data: PresenceData | null }
  | { t: 'query'; rid: string; q: Query };

/** Core → browser. */
export type ServerMessage =
  /** Sent once on connect: the loaded file, this connection's presence id, the
   *  cross-session "recently served flows" list (absolute paths, most-recent
   *  first, existing-only) for the editor's path-switch dropdown, and the
   *  core's home dir so the editor can abbreviate paths to `~/…` for display
   *  (paths stay absolute on the wire — they round-trip as `switchFile`
   *  targets). */
  | { t: 'hello'; file: string; clientId: string; recents: string[]; home: string }
  /**
   * Result of a `switchFile`. On success (`ok:true`) it is broadcast to every
   * client and immediately followed by a fresh `graph` + node snapshot for the
   * new file; `file` is the resolved absolute path and `recents` the updated
   * list. On failure (`ok:false`) it goes to the requesting client only, with
   * `error` set and the current flow left untouched.
   */
  | { t: 'switched'; ok: boolean; file?: string; recents: string[]; error?: string }
  /** The Cocoon definition file, verbatim. */
  | { t: 'graph'; yaml: string }
  /** A single node's state changed. Streamed; never carries bulk data. */
  | { t: 'node'; id: string; state: NodeState }
  /** Reply to a `query`, correlated by `rid`. `data` is always bounded. */
  | { t: 'queryResult'; rid: string; ok: boolean; data?: unknown; error?: string }
  /** Full presence snapshot, rebroadcast whenever any client announces or
   *  disconnects. Tiny by construction. */
  | { t: 'presence'; clients: PresenceEntry[] };
