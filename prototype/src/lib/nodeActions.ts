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
   * Pop the node's attached view out into a detached, larger window. Purely
   * editor-side (the view payload already streams in node-state — no protocol
   * message), but it lives here so the toolbar reaches the window manager
   * prop-drill-free, exactly like the core actions. Multiple open windows is
   * the side-by-side substrate brushing & linking will later sync over.
   */
  openView(id: string): void;
}

const KEY = Symbol('cocoon-node-actions');

export const provideNodeActions = (a: NodeActions) => setContext(KEY, a);
export const useNodeActions = () => getContext<NodeActions>(KEY);
