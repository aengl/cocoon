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

/**
 * A code-declared steering knob (keystone 5). The schema lives in node code —
 * the one narrow, deliberate registry-free exception (ports stay
 * YAML-structure-derived; this does *not*). Streamed to the editor in
 * `NodeState`; its *value* is a runtime overlay (`controlState`), never
 * written to YAML, exactly like `persist`. Discriminated by `kind`; this is
 * the steering tier's whole vocabulary (the free-form tier is the
 * server-rendered HTML control — no schema at all).
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
   * The node's code-declared steering controls (keystone 5). Lazy: present
   * once the node's module has resolved (first run / peek), since resolution
   * is pull-triggered (keystone 6). Absent = node declares none / not yet
   * resolved.
   */
  controls?: Record<string, ControlSchema>;
  /**
   * The *effective* control values: a runtime overlay (set via `setControl`)
   * over the schema defaults. Never written to YAML and reset on core
   * restart — the `persistOverride` twin. Keyed by control name.
   */
  controlState?: Record<string, unknown>;
  /**
   * Server-rendered HTML for the node's free-form control (keystone 5 action
   * tier — the Phoenix-LiveView model). Lazy like `controls`:
   * present once the module has resolved (after a run or a `controlEvent`).
   * Inert HTML — interactivity rides a generic shim + `data-cocoon-event`
   * attributes, never node code in the browser.
   */
  controlHtml?: string;
  /**
   * The same control rendered for the detached window surface (`render` with
   * `ctx.surface === 'window'`). Streamed alongside `controlHtml` so the
   * editor can open the full form without a round-trip; the node decides how
   * (or whether) the two differ.
   *
   * **Wire-side dedupe (load-bearing for the editor):** the core OMITS this
   * field when its bytes would equal `controlHtml` (the non-branching-render
   * case — when `render()` ignores `ctx.surface`). Consumers MUST fall back
   * to `controlHtml` when this is undefined; `controlWindowHtml === undefined`
   * does NOT mean "no window surface", it means "same as inline".
   * `controlHtml === undefined` is the actual "no control" signal.
   */
  controlWindowHtml?: string;
  /**
   * The control's core-computed bounded payload (`control.data` — the
   * pure data half, fed to the render hook as `props.data`). Streamed so
   * the **agent reads the same bounded slice the human sees** instead
   * of scraping rendered HTML. Absent = node declares no free-form control
   * / no data half.
   */
  controlData?: unknown;
  /**
   * Present ⇒ the node's co-located module also exports a browser render
   * `hook` (keystone 2/5 — the LiveView `phx-hook` analogue). `mtimeMs` is
   * the cache-bust token: the editor dynamic-`import()`s the core's
   * `/hook/<type>?m=<mtimeMs>`, the browser twin of the resolver's
   * `?m=<mtime>` hot-reload. Absent = no hook (or not yet resolved).
   */
  controlHook?: { mtimeMs: number };
  /**
   * The node's code-declared preferred detached-window size in CSS px
   * (`control.window`). Lazy like `controlHtml` (present once the module has
   * resolved). The editor uses it as the window's *initial* size; a user
   * drag-resize then wins. Absent = no hint ⇒ editor default. Persisting the
   * last user size/pos is deferred (ephemeral geometry — presence territory).
   */
  controlWindow?: { width: number; height: number };
}

/**
 * Client presence — an entirely optional, orthogonal side-channel. Each client
 * (an editor tab, a headless agent) MAY announce an opaque blob of its own
 * ephemeral UI state; the core just collects it per-connection, rebroadcasts
 * it, and **interprets nothing**. Nothing in processing / the pull graph / the
 * lossless contract depends on it, so it can't break any of them — it exists
 * solely so clients can know about each other (human↔AI collaboration; the
 * substrate the long-deferred brushing & linking would also ride). Evaporates
 * on disconnect. The conventional fields below are *client convention*, not
 * core-enforced — `data` is opaque to the core (`[k:string]:unknown`).
 */
export interface PresenceData {
  /** Human-facing label for the peer list / suggestion bubble. */
  label?: string;
  /** The client's Svelte Flow camera + the node ids currently in view. */
  viewport?: { x: number; y: number; zoom: number };
  visibleNodes?: string[];
  /**
   * Node ids the human has *selected* in the canvas — a single click, or the
   * rectangle from a shift-drag (Svelte Flow's selection box; xyflow's
   * `selectionKey`/`selectionOnDrag` mechanic). The mirror of `callouts`:
   * **agent → human is a callout, human → agent is a selection**. Pure
   * presence: announced when the canvas selection changes, evaporates with
   * the socket. The agent reads this so "these nodes" / "the ones I've got
   * highlighted" maps to a concrete id list without the human having to type
   * them. Synthetic group artifacts (xyflow `type:'group'`) are filtered out
   * client-side — only real cocoon node ids land here.
   */
  selectedNodes?: string[];
  /** Node ids whose free-form control surface this client has open. */
  openControls?: string[];
  /**
   * Live, *unsaved* control input: nodeId → { fieldName → value }. The
   * uncontrolled-form draft a human is mid-typing (captured blur/debounced) —
   * this is how a peer/agent reads "what's pasted in the box" without the
   * value ever being saved or touching the node's control blob.
   */
  controlDrafts?: Record<string, Record<string, string>>;
  /**
   * Agent→editor: a single proposed change-set, rendered by the editor as ONE
   * generic toast (Apply/Discard). Re-announcing the same `id` supersedes the
   * bubble (presence is a projection of current state, not an event log).
   */
  changeSet?: ChangeSet;
  /**
   * Editor→agent: verdicts on change-sets this client resolved, keyed by
   * `ChangeSet.id`. The announcing agent watches peer presence for its id —
   * the response rides the SAME channel, so the core stays a dumb relay.
   */
  resolvedSuggestions?: { id: string; verdict: SuggestionVerdict }[];
  /**
   * Agent→editor: per-node informational pointers ("look at this node — it
   * still has a `view:` key"). Deliberately NOT a CTA like a suggestion —
   * the editor's role is *pointing*, the chat's role is *conversation*; the
   * editor never replies with text. Fire-and-forget: the editor snapshots a
   * callout on first observation into its OWN local state, so the marker
   * outlives the agent's disconnect (the only presence consumer that does
   * — every other field evaporates with the socket). Re-announcing the same
   * `id` updates the snapshot in place and resurrects it if dismissed.
   */
  callouts?: Callout[];
  /**
   * Editor→agent: ids the human has dismissed in the editor. The agent reads
   * this purely to *learn* that a callout has been seen (e.g. for telemetry,
   * or to avoid re-announcing the same point). Not a verdict — there is
   * nothing to respond *to*; the human's reply belongs in chat.
   */
  dismissedCallouts?: string[];
  /**
   * Editor→agent: short, chat-friendly labels (`C1`, `C2`, …) the editor
   * assigns to each observed callout id, in first-seen order. The agent
   * announces with its own (opaque, long) id and learns its label by reading
   * peer presence — pure naming convenience for the conversation in chat
   * ("dismiss C2"), no semantic load.
   */
  calloutLabels?: Record<string, string>;
  /** Opaque/extensible — the core never inspects beyond relaying it. */
  [k: string]: unknown;
}

/**
 * One agent-announced callout — a visible marker (node badge + minimap ring)
 * with a free-text message the human reads and dismisses. See `PresenceData.
 * callouts` for the full lifetime/snapshot model.
 */
export interface Callout {
  /** Stable id chosen by the announcer; re-announce supersedes/resurrects. */
  id: string;
  /** Target node id (the marker is drawn on this node). */
  node: string;
  /** Free-text shown in the badge popover (one short paragraph). */
  message: string;
  /** Display label of the announcer ("claude"), shown in the popover. */
  from?: string;
  /** Visual emphasis. Default `info`. */
  tone?: 'info' | 'warn' | 'error';
  /** Optional announcer timestamp (ms since epoch); the editor falls back to
   *  observation time if absent. Drives the carousel's stable iteration order. */
  ts?: number;
}

export type SuggestionVerdict = 'applied' | 'discarded' | 'stale';

/** A coherent unit of proposed edits — the agent owns batching granularity. */
export interface ChangeSet {
  /** Stable id; re-announce supersedes, peer reports the verdict by this id. */
  id: string;
  /** Display label of the suggester ("claude"), for the bubble. */
  from?: string;
  /** Optional one-line human summary ("Translated the description to English"). */
  note?: string;
  edits: ChangeEdit[];
}

export interface ChangeEdit {
  /** Target node id. */
  node: string;
  /** Target form field — the `name` attribute in the node's control HTML
   *  (the existing generic convention the shim already serialises by). */
  field: string;
  /** The proposed value to inject into that field. */
  value: string;
  /**
   * What the suggestion was computed against (e.g. the displayed item key).
   * Apply drift-validates against this and self-invalidates if the surface
   * has moved on — same "derive, don't trust a stale snapshot" discipline as
   * keystone 5. Opaque shape; the editor only equality-checks declared keys.
   */
  context?: Record<string, unknown>;
}

/** One peer's presence as the core relays it (connection-keyed; `id` is the
 *  core-assigned connection id, authoritative + evaporates on disconnect). */
export interface PresenceEntry {
  id: string;
  client: string;
  data: PresenceData;
  ts: number;
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
   * Set one steering control's value. A *session* override held on the
   * processing instance — never written to the hand-edited YAML (the lossless
   * contract; there is no save path) — exactly like `setPersist`: keystone 5
   * is persist's mechanism generalised. Pure pull: the core marks the node
   * (and its downstream) `stale` and streams the new effective `controlState`;
   * it does **not** pull upstream, re-`process()`, or eager-cascade — the user
   * re-pulls. The agent's typed *act* surface (mirrors the `query` *read*
   * surface); an invalid key/value is ignored, like `setPersist` on an
   * unknown node.
   */
  | { t: 'setControl'; node: string; key: string; value: unknown }
  /**
   * A free-form control event (form submit / tagged button) from the browser
   * shim or the agent — same channel for both (the agent reads the node
   * module to learn the vocabulary, keystone 6; not a registry). The node's
   * `control.event` handler changes the durable truth; the core then
   * re-derives the control's bounded payload (`control.data`) and re-streams
   * `controlHtml`/`controlWindowHtml`/`controlData` (and, if the handler
   * called `ctx.markStale()`, the `stale` status). Fire-and-forget. The
   * reserved `$mount` (the shim fires it once per surface mount) skips the
   * handler entirely — it only triggers that re-derive + stream, so a
   * surface shows its live payload as soon as it appears.
   */
  | { t: 'controlEvent'; node: string; event: string; payload?: unknown }
  /**
   * Re-read the YAML after the flow was edited on disk (the AI builds/wires a
   * node, then reloads). **Selective by default** (keystone-6): each node keeps
   * its result iff its own compute signature *and* entire transitive upstream
   * are unchanged — so the per-save file watcher and `cocoon reload` don't
   * wipe every computed result. `reset:true` forces the **full reset** (store
   * cleared, all nodes idle; persisted nodes restore from disk cache) — a
   * deliberate, user-initiated "recompute everything", sent only by the
   * editor's toolbar ↻ button. Either way the core re-broadcasts `graph` + a
   * fresh state snapshot so every client repaints — "fix it, watch it light
   * up".
   */
  | { t: 'reload'; reset?: boolean }
  /**
   * Announce/replace this client's presence blob (optional, orthogonal). The
   * core stores it per-connection and rebroadcasts; it interprets nothing.
   * `client` is a self-chosen display label; `data` is opaque (see
   * `PresenceData` for the conventional shape). `data:null` clears it.
   */
  | { t: 'presence'; client: string; data: PresenceData | null }
  /** Correlated read-only introspection request; reply is `queryResult`. */
  | { t: 'query'; rid: string; q: Query };

/** Core -> browser. */
export type ServerMessage =
  /** Sent once on connect: the loaded file + this connection's core-assigned
   *  presence id (so a client can recognise / filter out its own entry). */
  | { t: 'hello'; file: string; clientId: string }
  /** The Cocoon definition file, verbatim. The editor runs its own lossless
   *  loader on this — the core never re-serialises YAML. */
  | { t: 'graph'; yaml: string }
  /** A single node's state changed. Streamed; never carries bulk data. */
  | { t: 'node'; id: string; state: NodeState }
  /** Reply to a `query`, correlated by `rid`. `data` is always bounded. */
  | { t: 'queryResult'; rid: string; ok: boolean; data?: unknown; error?: string }
  /**
   * The full presence snapshot (every connected client's last-announced
   * blob), rebroadcast to all whenever any client announces or disconnects.
   * Tiny by construction; a client filters its own entry by `hello.clientId`.
   */
  | { t: 'presence'; clients: PresenceEntry[] };
