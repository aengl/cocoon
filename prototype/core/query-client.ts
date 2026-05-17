/**
 * The standard front door to a *running* core. Not a fresh Runtime — a thin
 * WS client to whatever `cocoon serve` is already up, so the session state
 * (the store a previous `process` filled, which `peek` reads) is the live
 * one. This is the `redis-cli`/`psql -c` shape: connect, ask, print, exit.
 * The daemon stays the source of truth; this is just a mouth for it.
 *
 * Headless `cocoon run` is unaffected — it still owns its own Runtime and
 * streams a port to stdout. These are siblings, not replacements.
 */
import { WebSocket } from 'ws';
import type {
  ClientMessage,
  Query,
  ServerMessage,
} from '../src/lib/protocol.ts';

/** `localhost:4000` / `4000` / a full `ws://…` → a ws URL. */
export function normalizeCore(core: string): string {
  if (/^wss?:\/\//.test(core)) return core;
  if (/^\d+$/.test(core)) return `ws://localhost:${core}`;
  return `ws://${core}`;
}

class CoreUnreachable extends Error {}

interface Done<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

/**
 * One connection's lifetime. The message handler is attached *synchronously*
 * with the socket — before `open` — so the connect burst (hello/graph/
 * snapshot, sent by the server the instant we connect) is never dropped.
 * `sendReload` depends on seeing that first `graph`; an `await`-then-listen
 * shape silently loses it.
 */
function session<T>(
  core: string,
  onOpen: (send: (m: ClientMessage) => void) => void,
  onMessage: (m: ServerMessage, done: Done<T>) => void,
  timeoutMs = 10_000
): Promise<T> {
  const url = normalizeCore(core);
  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(url);
    let opened = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`core did not respond within ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      // Hard-terminate: this is a one-shot client, and a graceful close
      // waits on the server to ack — which a busy core may not do promptly,
      // leaving the process hanging well past its answer.
      ws.terminate();
    };
    const done: Done<T> = {
      resolve: v => {
        finish();
        resolve(v);
      },
      reject: e => {
        finish();
        reject(e);
      },
    };
    ws.on('error', (e: Error) =>
      done.reject(
        opened
          ? e
          : new CoreUnreachable(
              `no core at ${url} (${e.message}). Is \`cocoon serve\` running?`
            )
      )
    );
    ws.on('message', raw => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      onMessage(m, done);
    });
    ws.on('open', () => {
      opened = true;
      onOpen(msg => ws.send(JSON.stringify(msg)));
    });
  });
}

/** Send one correlated query; resolve its bounded `data` (throw on ok:false). */
export function sendQuery(
  core: string,
  q: Query,
  timeoutMs = 10_000
): Promise<unknown> {
  const rid = `cli-${Date.now().toString(36)}`;
  return session<unknown>(
    core,
    send => send({ t: 'query', rid, q }),
    (m, done) => {
      // Ignore the connect burst and any other client's traffic.
      if (m.t !== 'queryResult' || m.rid !== rid) return;
      m.ok
        ? done.resolve(m.data)
        : done.reject(new Error(m.error ?? 'query failed'));
    },
    timeoutMs
  );
}

/**
 * Trigger a flow reload and report the resulting state. The stream is
 * deterministic: `graph` #1 + snapshot (connect burst, queued synchronously
 * on connection) then `graph` #2 + snapshot (the post-reload rebroadcast,
 * emitted only after `reload()` resolves). We wait for the *second* graph and
 * capture the snapshot after it — no follow-up query racing the async reload.
 */
export function sendReload(
  core: string
): Promise<{ file?: string; nodes: number; status: Record<string, number> }> {
  let file: string | undefined;
  let graphs = 0;
  const post = new Map<string, string>();
  let settle: ReturnType<typeof setTimeout> | undefined;
  return session(
    core,
    send => send({ t: 'reload' }),
    (m, done) => {
      if (m.t === 'hello') file = m.file;
      else if (m.t === 'graph') graphs++;
      else if (m.t === 'node' && graphs >= 2) post.set(m.id, m.state.status);
      if (graphs < 2) return;
      // Snapshot arrives back-to-back after graph #2; settle once quiet
      // (handles any node count, including an emptied flow).
      clearTimeout(settle);
      settle = setTimeout(() => {
        const status: Record<string, number> = {};
        for (const s of post.values()) status[s] = (status[s] ?? 0) + 1;
        done.resolve({ file, nodes: post.size, status });
      }, 150);
    }
  );
}

export { CoreUnreachable };
