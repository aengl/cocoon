/**
 * Out-of-band crash containment for node processing.
 *
 * `runOne`'s try/catch only sees errors that travel through
 * `await node.process()`. A node doing async I/O can throw from an event
 * handler or timer with nothing awaiting it — e.g. `pg` throwing
 * "SASL: client password must be a string" synchronously from a TLS socket
 * `data` handler when `PGPASSWORD` is unset. That is an `uncaughtException`
 * (or `unhandledRejection`) that bypasses the catch and would kill the whole
 * core, taking the editor server / headless run down with it.
 *
 * The execution model already says a node failure is the *node's*, never the
 * core's ("runOne never rethrows … the core should never error"). This
 * extends that invariant to the out-of-band case: the crash is rerouted onto
 * the node that was running, becoming its `error` state via the very same
 * `runOne` catch, and the process survives.
 *
 * One process-lifetime listener — adding/removing per node would race and trip
 * MaxListeners. Attribution is unambiguous because the plan loop runs nodes
 * strictly sequentially (`for … of order` with `await runOne`), so at most one
 * guarded run is ever in flight. A straggler that fires *after* its node has
 * already finished (an abandoned socket the node never closed) has no one to
 * blame: it is logged and swallowed, never fatal.
 */

let active: { id: string; fail: (err: unknown) => void } | null = null;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const route = (err: unknown) => {
    const a = active;
    if (a) {
      active = null; // first blame only; later stragglers fall through to log
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
 * result/rejection, or — if an out-of-band crash fires while `id` is the
 * active node — with that error, so `runOne`'s existing catch turns it into
 * the node's `error` state. If `fn` is abandoned (its promise never settles,
 * as with a hung `pg` connect), the guarded promise is already rejected and
 * the late settle is a no-op.
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
