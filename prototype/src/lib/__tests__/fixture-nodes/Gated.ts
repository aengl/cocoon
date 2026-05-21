import type { CocoonProcessNode } from '../../../../core/contract.ts';

/**
 * Test-only fixture: a node whose `process()` blocks on an externally
 * controlled gate, keyed by `ctx.nodeId`. Lets tests observe concurrency
 * deterministically — release individual nodes in chosen orders and assert
 * which nodes were `running` at the same time.
 *
 * The gate registry lives on `globalThis` because the test imports this
 * module through Vite while the runtime resolver imports it as a `file://`
 * URL with an mtime cache-bust — two distinct module instances. Sharing the
 * registry on the global makes the test's `release()`/`entered()` calls
 * actually reach the running node body.
 *
 * Output passes through `data` (or seeds the node id when there's no
 * upstream) so downstream nodes have a value to read, and so `hasOutputs`
 * returns true once a gated node has finished — the same signal the
 * frontier scheduler in `runtime.ts` watches.
 */
interface Gate {
  released: Promise<void>;
  release: () => void;
  entered: Promise<void>;
  markEntered: () => void;
  /**
   * How many times `process()` actually entered for this id. Distinct from
   * the `entered` promise (one-shot): used by cross-plan dedupe tests to
   * verify that overlapping plans share **one** body execution rather than
   * re-running the node twice.
   */
  entries: number;
}

const REGISTRY_KEY = '__cocoonGatedFixtureRegistry';
type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, Gate>;
};
const g = globalThis as GlobalWithRegistry;
const registry: Map<string, Gate> = (g[REGISTRY_KEY] ??= new Map<string, Gate>());

/** Arm a gate for `nodeId`; the node blocks at the gate until `release()`. */
export function arm(nodeId: string): {
  release: () => void;
  entered: Promise<void>;
  entries: () => number;
} {
  let release!: () => void;
  let markEntered!: () => void;
  const released = new Promise<void>(r => (release = r));
  const entered = new Promise<void>(r => (markEntered = r));
  const gate: Gate = {
    released,
    release,
    entered,
    markEntered,
    entries: 0,
  };
  registry.set(nodeId, gate);
  return { release, entered, entries: () => gate.entries };
}

/** Forget every armed gate (call in `afterEach`). */
export function reset() {
  for (const gate of registry.values()) gate.release(); // unblock anything still parked
  registry.clear();
}

export const Gated: CocoonProcessNode = {
  category: 'Test',
  description: 'Test fixture: blocks until externally released.',
  async *process(ctx) {
    const gate = registry.get(ctx.nodeId);
    if (gate) {
      gate.entries++;
      gate.markEntered();
      await gate.released;
    }
    const input = ctx.ports.read() as { data?: unknown };
    const data = input.data === undefined ? ctx.nodeId : input.data;
    ctx.ports.write({ data });
    return `gated:${ctx.nodeId}`;
  },
};
