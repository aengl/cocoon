/**
 * Out-of-band crash containment for node processing.
 *
 * `runOne`'s try/catch only sees errors travelling through `await
 * node.process()`. A node's async I/O can throw from an event handler or
 * timer with nothing awaiting it (e.g. pg throwing synchronously from a TLS
 * socket `data` handler) — an `uncaughtException`/`unhandledRejection` that
 * would otherwise kill the core. This reroutes such a crash onto the node
 * that was running, so it becomes that node's `error` state.
 *
 * One process-lifetime listener (per-node add/remove would race
 * MaxListeners). A straggler that fires after its node has already finished
 * — an abandoned socket the node never closed — has no one to blame: logged
 * and swallowed, never fatal.
 */

let active: { id: string; fail: (err: unknown) => void } | null = null;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const route = (err: unknown) => {
    const a = active;
    if (a) {
      active = null; // first blame wins; stragglers fall through to log
      a.fail(err);
    } else {
      console.error(
        '[cocoon] uncaught error with no active node — core kept alive:',
        err
      );
    }
  };
  process.on('uncaughtException', route);
  process.on('unhandledRejection', route);
}

/**
 * Drive `fn` as node `id`. Settles exactly once: with `fn`'s own
 * result/rejection, or — if an out-of-band crash fires while `id` is active
 * — with that error. An abandoned `fn` (promise never settles) leaves the
 * guarded promise already rejected; the late settle is a no-op.
 */
export function guardNodeRun<T>(
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  install();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (act: () => void) => {
      if (settled) return;
      settled = true;
      if (active?.id === id) active = null;
      act();
    };
    active = {
      id,
      fail: err =>
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err)))
        ),
    };
    fn().then(
      v => finish(() => resolve(v)),
      e => finish(() => reject(e))
    );
  });
}
