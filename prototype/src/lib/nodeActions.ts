/**
 * The contract between the editor shell (which owns the core connection) and
 * the node component (which renders the floating action toolbar). Provided via
 * Svelte context so custom nodes rendered deep inside Svelte Flow can reach
 * the core without prop-drilling through the library.
 *
 * Keep this list growable: a new node action is one entry here + one button
 * descriptor in CocoonNode — nothing else.
 */
import { getContext, setContext } from 'svelte';

export interface NodeActions {
  /** Reactive: true when a core is attached and the graph is loaded. */
  readonly connected: boolean;
  /** Process this node and everything upstream it depends on. */
  process(id: string): void;
  /** Drop the node's output + persisted cache, forcing a re-run. */
  invalidate(id: string): void;
  /** Toggle runtime disk-persistence for the node (session-only). */
  setPersist(id: string, value: boolean): void;
  /**
   * Set one of the node's code-declared steering controls (keystone 5). A
   * session override — the node goes `stale`, the user re-pulls; never YAML.
   */
  setControl(id: string, key: string, value: unknown): void;
  /**
   * Send a free-form control event (Phoenix-LiveView model). The node's
   * `control.event` handler interprets it; the re-rendered HTML streams back
   * in node-state. The browser side is a generic shim — no node code here.
   */
  controlEvent(id: string, event: string, payload?: unknown): void;
  /**
   * Report the live, *unsaved* value of a node's free-form control surface
   * (every named field) so the editor can announce it as presence — how a
   * peer/agent reads "what's pasted in the box". Debounced upstream; this is
   * just the prop-drill-free seam from the generic control shim to the
   * presence client. Entirely optional, never touches the node.
   */
  reportDraft(id: string, fields: Record<string, string>): void;
  /**
   * Pop the node's free-form control into a detached window (the `window`
   * surface). Editor-side, like `openView` — the `controlWindowHtml` already
   * streams in node-state, no protocol message. Triggered by the node's own
   * compact "open" button via the shim's client-reserved `$open`.
   */
  openControl(id: string): void;
  /**
   * Pop the node's attached view out into a detached, larger window. Purely
   * editor-side (the view payload already streams in node-state — no protocol
   * message), but it lives here so the toolbar reaches the window manager
   * prop-drill-free, exactly like the core actions. Multiple open windows is
   * the side-by-side substrate brushing & linking will later sync over.
   */
  openView(id: string): void;
  /**
   * The core's HTTP origin — all a node surface needs to resolve its render
   * hook through the **single** shared resolver (`hookStore.resolvedHook`,
   * keystone 2/5). Not a `loadHook` method: resolution logic is single
   * -sourced; this is just prop-drill-free access to `core.httpBase` for the
   * inline node, mirroring how `ControlWindow` gets it from `App` directly.
   */
  readonly httpBase: string;
}

const KEY = Symbol('cocoon-node-actions');

export const provideNodeActions = (a: NodeActions) => setContext(KEY, a);
export const useNodeActions = () => getContext<NodeActions>(KEY);
