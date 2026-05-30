import type { CocoonProcessNode } from '../../../../core/contract.ts';

/**
 * Test-only fixture for cancellation's second layer: a node parked in ONE long
 * `await` with no intervening `yield`, wired to `ctx.signal`. The yield-boundary
 * `gen.return` can't reach it (there is no next yield), so this proves the
 * signal path — aborting `ctx.signal` rejects the in-flight await at once.
 */
export const SignalWaiter: CocoonProcessNode = {
  category: 'Test',
  description: 'Test fixture: parks in one signal-wired await until cancelled.',
  async *process(ctx) {
    await new Promise<void>((_resolve, reject) => {
      const abort = () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (ctx.signal.aborted) return abort();
      ctx.signal.addEventListener('abort', abort, { once: true });
      // Otherwise never settles — only cancellation ends this node.
    });
    ctx.ports.write({ data: ctx.nodeId });
    return 'done';
  },
};
