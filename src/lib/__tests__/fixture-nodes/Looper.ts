import type { CocoonProcessNode } from '../../../../core/contract.ts';

/**
 * Test-only fixture for cancellation: a long crawl-style loop that `yield`s
 * progress and `breathe`s each iteration but NEVER wires `ctx.signal`. It
 * stands in for a well-behaved node that the runtime can stop purely at the
 * yield boundary (the `gen.return` path), and its `finally` lets a test assert
 * the node's cleanup ran on cancel.
 *
 * Like `Gated`, the coordination registry lives on `globalThis` so the test's
 * Vite-imported module and the resolver's `file://`-imported copy share it.
 */
interface Loop {
  /** Flip to let the loop finish normally (the re-run-after-cancel path). */
  finish: () => void;
  done: { value: boolean };
  entered: Promise<void>;
  markEntered: () => void;
  iterations: number;
  /** Set true by the node's `finally` — proves cleanup ran on cancel. */
  cleanedUp: boolean;
}

const REGISTRY_KEY = '__cocoonLooperFixtureRegistry';
type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, Loop>;
};
const g = globalThis as GlobalWithRegistry;
const registry: Map<string, Loop> = (g[REGISTRY_KEY] ??= new Map());

/** Arm a loop for `nodeId`; it crawls until `finish()` or cancellation. */
export function arm(nodeId: string): {
  finish: () => void;
  entered: Promise<void>;
  iterations: () => number;
  cleanedUp: () => boolean;
} {
  let markEntered!: () => void;
  const entered = new Promise<void>(r => (markEntered = r));
  const done = { value: false };
  const loop: Loop = {
    finish: () => (done.value = true),
    done,
    entered,
    markEntered,
    iterations: 0,
    cleanedUp: false,
  };
  registry.set(nodeId, loop);
  return {
    finish: loop.finish,
    entered,
    iterations: () => loop.iterations,
    cleanedUp: () => loop.cleanedUp,
  };
}

/** Forget every armed loop (call in `afterEach`). */
export function reset() {
  for (const loop of registry.values()) loop.finish();
  registry.clear();
}

export const Looper: CocoonProcessNode = {
  category: 'Test',
  description: 'Test fixture: crawl-style yield+breathe loop, cancellable.',
  async *process(ctx) {
    const loop = registry.get(ctx.nodeId);
    loop?.markEntered();
    try {
      let i = 0;
      while (!loop?.done.value) {
        if (loop) loop.iterations = ++i;
        yield ['crawling', i % 100] as [string, number];
        // A real timer so the runtime's drive loop regains control between
        // iterations and can observe a cancel at this yield boundary.
        await ctx.breathe(5);
      }
      const input = ctx.ports.read() as { data?: unknown };
      ctx.ports.write({ data: input.data ?? ctx.nodeId });
      return `looped:${ctx.nodeId}`;
    } finally {
      if (loop) loop.cleanedUp = true;
    }
  },
};
