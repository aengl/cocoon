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
}

const KEY = Symbol('cocoon-node-actions');

export const provideNodeActions = (a: NodeActions) => setContext(KEY, a);
export const useNodeActions = () => getContext<NodeActions>(KEY);
