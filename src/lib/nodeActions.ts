/**
 * Contract between the editor shell (which owns the core connection) and the
 * node component (which renders the floating action toolbar). Provided via
 * Svelte context so nested nodes can reach the core without prop-drilling
 * through xyflow.
 */
import { getContext, setContext } from 'svelte';

export interface NodeActions {
  /** Reactive: true when a core is attached and the graph is loaded. */
  readonly connected: boolean;
  /**
   * Process this node and everything upstream it depends on.
   *
   * Stale upstream is reused by default (kept amber, fed downstream; the
   * target finishes `stale` itself). `{ rerunStale: true }` forces every
   * stale upstream to recompute (toolbar's shift-click route).
   */
  process(id: string, opts?: { rerunStale?: boolean }): void;
  /** Cooperatively cancel a running node. Lands `error: "Cancelled"`, output
   *  dropped; downstream blocks. No-op if the node isn't running. */
  cancel(id: string): void;
  /** Drop the node's output + persisted cache, forcing a re-run. */
  invalidate(id: string): void;
  /** Toggle runtime disk-persistence (session-only). */
  setPersist(id: string, value: boolean): void;
  /** Set one steering control value. Session override; the node goes `stale`,
   *  the user re-pulls; never YAML. */
  setControl(id: string, key: string, value: unknown): void;
  /** Resolve a node's module so its steering schema streams without running it
   *  — reveals an idle node's knobs for pre-run tweaking. Read-only; control-
   *  less node is a no-op. */
  resolveControls(id: string): void;
  /** Toggle the per-node "controls pinned open" reveal flag (editor-local), so
   *  the human can surface an idle node's knobs before its first pull. */
  toggleReveal(id: string): void;
  /** Send a free-form control event. The re-rendered HTML streams back in
   *  node-state; the browser side is the generic shim. */
  controlEvent(id: string, event: string, payload?: unknown): void;
  /** Forward a browser-side control-hook diagnostic (an uncaught
   *  `mount`/`update`/`destroy` throw) to the core, which folds it into the
   *  node's log buffer — the agent's only window onto a control that breaks in
   *  the browser. Fire-and-forget. */
  controlLog(id: string, level: 'error' | 'warn' | 'log', text: string): void;
  /** Report a control surface's live unsaved values so the editor can
   *  announce them as presence (the "what's pasted in the box" view).
   *  Debounced upstream; optional. */
  reportDraft(id: string, fields: Record<string, string>): void;
  /** Pop a control into a detached window. The `controlWindowHtml` already
   *  streams in node-state; this is purely the prop-drill-free seam.
   *  Triggered by the shim's client-reserved `$open`. */
  openControl(id: string): void;
  /** Copy a node id to the clipboard. Ids are long; chat references them
   *  often. */
  copyNodeId(id: string): void;
  /** Dismiss one agent-announced callout. Editor-local; echoed back via
   *  presence purely as a "seen" signal. */
  dismissCallout(id: string): void;
  /** The core's HTTP origin — all a node surface needs to resolve its render
   *  hook through `hookStore.resolvedHook`. */
  readonly httpBase: string;
}

const KEY = Symbol('cocoon-node-actions');

export const provideNodeActions = (a: NodeActions) => setContext(KEY, a);
export const useNodeActions = () => getContext<NodeActions>(KEY);
