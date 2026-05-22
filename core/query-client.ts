/**
 * Thin WS client to a running `cocoon serve`. Connect, send, await a
 * stream condition, print, exit. The daemon is the source of truth.
 * `cocoon run` is unaffected — it owns its own Runtime.
 */
import { WebSocket } from 'ws';
import type {
  Callout,
  ChangeSet,
  ClientMessage,
  PresenceEntry,
  Query,
  ServerMessage,
  SuggestionVerdict,
} from '../src/lib/protocol.ts';

/** `localhost:22242` / `22242` / a full `ws://…` → a ws URL. */
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
 * One connection's lifetime. The message handler is attached SYNCHRONOUSLY
 * with the socket — before `open` — so the server's connect burst
 * (hello/graph/snapshot, sent the instant we connect) is never dropped.
 * An `await`-then-listen shape would silently lose it.
 */
function session<T>(
  core: string,
  onOpen: (send: (m: ClientMessage) => void) => void,
  onMessage: (
    m: ServerMessage,
    done: Done<T>,
    send: (m: ClientMessage) => void
  ) => void,
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
      // Hard-terminate: a graceful close waits on the server to ack, which
      // a busy core may not do promptly — the process would hang past its
      // answer.
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
    const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg));
    ws.on('message', raw => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      onMessage(m, done, send);
    });
    ws.on('open', () => {
      opened = true;
      onOpen(send);
    });
  });
}

/** Send one correlated query; resolve its bounded `data`. */
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
      if (m.t !== 'queryResult' || m.rid !== rid) return;
      m.ok
        ? done.resolve(m.data)
        : done.reject(new Error(m.error ?? 'query failed'));
    },
    timeoutMs
  );
}

/**
 * Trigger a reload and report the resulting state. Stream is deterministic:
 * `graph` #1 + snapshot (connect burst), then `graph` #2 + snapshot
 * (post-reload rebroadcast). Wait for the second `graph` so no follow-up
 * query races the async reload.
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
      // Snapshot arrives back-to-back after graph #2; settle once quiet.
      clearTimeout(settle);
      settle = setTimeout(() => {
        const status: Record<string, number> = {};
        for (const s of post.values()) status[s] = (status[s] ?? 0) + 1;
        done.resolve({ file, nodes: post.size, status });
      }, 150);
    }
  );
}

interface SetControlResult {
  status: string;
  controls?: Record<string, unknown>;
  controlState?: Record<string, unknown>;
}

/**
 * Set one steering control and report the authoritative resulting state.
 *
 * `setControl` has no correlated ack. `Runtime.setControl` ages the node
 * first (an early `{status:'stale'}` broadcast still carries the OLD value)
 * and then re-broadcasts the new `controlState`. So we anchor on
 * value-match — the first `node` broadcast whose `controlState[key]`
 * equals the requested value — not a positional count.
 *
 * Silent no-ops (unknown node/key, bad value, unresolved schema) never
 * produce a matching broadcast; the parallel correlated `query node` is the
 * fallback. If it lands and no match follows within a short settle, we
 * resolve from it: the unchanged `controlState` reports the no-op.
 */
export function sendSetControl(
  core: string,
  node: string,
  key: string,
  value: unknown,
  timeoutMs = 10_000
): Promise<SetControlResult> {
  const rid = `cli-${Date.now().toString(36)}`;
  const want = JSON.stringify(value);
  let queried: SetControlResult | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  return session<SetControlResult>(
    core,
    send => {
      send({ t: 'setControl', node, key, value });
      send({ t: 'query', rid, q: { kind: 'node', id: node } });
    },
    (m, done) => {
      if (m.t === 'node' && m.id === node) {
        if (JSON.stringify(m.state.controlState?.[key]) === want) {
          clearTimeout(settle);
          done.resolve({
            status: m.state.status,
            controls: m.state.controls,
            controlState: m.state.controlState,
          });
        }
        return;
      }
      if (m.t === 'queryResult' && m.rid === rid) {
        if (!m.ok) return done.reject(new Error(m.error ?? 'query failed'));
        queried = m.data as SetControlResult;
        // No-op fallback: read-back is truth if no match follows shortly.
        clearTimeout(settle);
        settle = setTimeout(() => done.resolve(queried!), 250);
      }
    },
    timeoutMs
  );
}

/**
 * Read the live presence snapshot. The connect burst includes a `presence`
 * frame after the node snapshot, so the first one resolves. Filter out our
 * own clientId defensively (a non-announcing connection isn't in the
 * snapshot anyway).
 */
export function readPresence(
  core: string,
  timeoutMs = 10_000
): Promise<PresenceEntry[]> {
  let me: string | undefined;
  return session<PresenceEntry[]>(
    core,
    () => {},
    (m, done) => {
      if (m.t === 'hello') me = m.clientId;
      else if (m.t === 'presence')
        done.resolve(m.clients.filter(c => c.id !== me));
    },
    timeoutMs
  );
}

export interface ProcessResult {
  status: string;
  summary?: string;
  error?: string;
}

/**
 * Run a node on a running core and resolve at a settled terminal state.
 * Target moves idle/stale → queued → running → done|stale|error. We settle
 * after a quiet beat so queued/running churn — and a pre-run `done` — is
 * ridden out, not mistaken for completion.
 */
export function sendProcess(
  core: string,
  node: string,
  opts: { rerunStale?: boolean } = {},
  timeoutMs = 60_000
): Promise<ProcessResult> {
  let settle: ReturnType<typeof setTimeout> | undefined;
  let last: ProcessResult | undefined;
  return session<ProcessResult>(
    core,
    send => send({ t: 'process', node, rerunStale: opts.rerunStale === true }),
    (m, done) => {
      if (m.t !== 'node' || m.id !== node) return;
      last = {
        status: m.state.status,
        summary: m.state.summary,
        error: m.state.error,
      };
      if (
        m.state.status === 'done' ||
        m.state.status === 'stale' ||
        m.state.status === 'error'
      ) {
        // `stale` here means derivative-of-stale (an upstream was stale and
        // not rerun). `--rerun-stale` is the way out.
        clearTimeout(settle);
        settle = setTimeout(() => done.resolve(last!), 250);
      } else {
        // queued/running → not terminal; cancel any pending settle.
        clearTimeout(settle);
      }
    },
    timeoutMs
  );
}

export interface SuggestResult {
  verdict: SuggestionVerdict;
  /** The peer (label) that resolved it. */
  by: string;
}

/**
 * Announce a change-set as our own presence and block until a peer reports
 * a verdict. Resolution is value-matched: scan every OTHER client's
 * `resolvedSuggestions` for our `changeSet.id`. Disconnecting on resolve
 * makes the presence evaporate naturally.
 */
export function suggest(
  core: string,
  changeSet: ChangeSet,
  label = 'agent',
  timeoutMs = 600_000
): Promise<SuggestResult> {
  let me: string | undefined;
  return session<SuggestResult>(
    core,
    send =>
      send({
        t: 'presence',
        client: label,
        data: { label, changeSet },
      }),
    (m, done) => {
      if (m.t === 'hello') {
        me = m.clientId;
        return;
      }
      if (m.t !== 'presence') return;
      for (const c of m.clients) {
        if (c.id === me) continue;
        const hit = c.data?.resolvedSuggestions?.find(
          r => r.id === changeSet.id
        );
        if (hit) {
          done.resolve({ verdict: hit.verdict, by: c.client });
          return;
        }
      }
    },
    timeoutMs
  );
}

export interface CalloutResult {
  /** Chat-friendly label assigned by the editor (`C1`, …). `undefined` if
   *  no editor was present to assign one. */
  label?: string;
  /** Internal id we announced. Stable for re-announce / dismissal. */
  internalId: string;
}

/**
 * Announce a callout as our own presence. Fire-and-forget: we wait briefly
 * only for the editor's label echo (`calloutLabels[id]`) so the CLI can
 * print the `C…` label. The marker survives our disconnect because the
 * editor snapshots callouts on first observation into its own local state.
 *
 * No editor around → no echo, empty `label`. Re-announcing the same id
 * later (once an editor connects) gets a label assigned.
 */
export function callout(
  core: string,
  c: Callout,
  label = 'agent',
  ackTimeoutMs = 1500
): Promise<CalloutResult> {
  const internalId = c.id;
  let me: string | undefined;
  return session<CalloutResult>(
    core,
    send =>
      send({
        t: 'presence',
        client: label,
        data: { label, callouts: [c] },
      }),
    (m, done) => {
      if (m.t === 'hello') {
        me = m.clientId;
        return;
      }
      if (m.t !== 'presence') return;
      for (const peer of m.clients) {
        if (peer.id === me) continue;
        const echoed = peer.data?.calloutLabels?.[internalId];
        if (echoed) {
          done.resolve({ label: echoed, internalId });
          return;
        }
      }
    },
    ackTimeoutMs
  ).catch(err => {
    // Timeout is the "no editor" path: empty-label success, not an error.
    // Anything else (CoreUnreachable, ws error) propagates.
    if (err instanceof Error && /did not respond within/.test(err.message))
      return { internalId };
    throw err;
  });
}

/**
 * Dismiss one of our callouts. Announces `dismissedCallouts: [id]` and
 * waits briefly for the editor to echo it back (confirming snapshot
 * update). Timeout resolves with `acked:false` — the announce frame still
 * flushed; the echo is only there to confirm processing.
 *
 * `idOrLabel`: internal id (`co-…`) or chat label (`C1`, …). An unknown
 * label is a hard error so a stale `C…` doesn't silently no-op.
 */
export function clearCallout(
  core: string,
  idOrLabel: string,
  label = 'agent',
  timeoutMs = 4000
): Promise<{ dismissedId: string; acked: boolean }> {
  const isShortLabel = /^C\d+$/.test(idOrLabel);
  let me: string | undefined;
  let resolveId: string | undefined;
  let announced = false;
  return session<{ dismissedId: string; acked: boolean }>(
    core,
    () => {
      /* deferred — we send from onMessage after resolving the label */
    },
    (m, done, send) => {
      if (m.t === 'hello') {
        me = m.clientId;
        return;
      }
      if (m.t !== 'presence') return;
      if (!announced) {
        // Resolve label→internal id on the first presence snapshot.
        if (isShortLabel) {
          for (const peer of m.clients) {
            if (peer.id === me) continue;
            const map = peer.data?.calloutLabels;
            if (!map) continue;
            for (const [internal, short] of Object.entries(map))
              if (short === idOrLabel) {
                resolveId = internal;
                break;
              }
            if (resolveId) break;
          }
          if (!resolveId) {
            done.reject(
              new Error(
                `no callout matching label ${idOrLabel} — known labels are in the editor's calloutLabels (try \`cocoon presence\`).`
              )
            );
            return;
          }
        } else {
          resolveId = idOrLabel;
        }
        announced = true;
        send({
          t: 'presence',
          client: label,
          data: { label, dismissedCallouts: [resolveId] },
        });
        return; // wait for the echo or for the timeout fallback
      }
      // Editor echoed our id back → snapshot updated.
      for (const peer of m.clients) {
        if (peer.id === me) continue;
        const dl = peer.data?.dismissedCallouts;
        if (Array.isArray(dl) && dl.includes(resolveId!)) {
          done.resolve({ dismissedId: resolveId!, acked: true });
          return;
        }
      }
    },
    timeoutMs
  ).catch(err => {
    // No editor to ack — surface as `acked:false`, not an error.
    if (err instanceof Error && /did not respond within/.test(err.message))
      return { dismissedId: resolveId ?? idOrLabel, acked: false };
    throw err;
  });
}

export { CoreUnreachable };
