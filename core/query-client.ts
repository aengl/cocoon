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

/**
 * Stream-anchored command. Every command below `sendQuery` (the only one
 * with a correlated reply, no settle) follows the same pattern: send
 * something on open, watch the stream for a condition, optionally settle
 * for a quiet period to let related broadcasts coalesce. Each command
 * declares only what's different — `onOpen` + a `match` returning one of:
 *   - `undefined` — keep watching
 *   - `{ resolve }` — resolve immediately
 *   - `{ settle, ms }` — schedule resolve in `ms`; a later match REPLACES
 *     the value/ms; a later `{ reset: true }` cancels the pending timer
 *   - `{ reset: true }` — cancel any pending settle, keep watching
 *   - `{ reject }` — terminate with this error
 */
interface StreamAnchor<T> {
  onOpen?(send: (m: ClientMessage) => void): void;
  match(
    m: ServerMessage,
    send: (m: ClientMessage) => void
  ):
    | undefined
    | { resolve: T }
    | { settle: T; ms: number }
    | { reset: true }
    | { reject: Error };
}

function streamAnchored<T>(
  core: string,
  anchor: StreamAnchor<T>,
  timeoutMs?: number
): Promise<T> {
  let settle: ReturnType<typeof setTimeout> | undefined;
  return session<T>(
    core,
    send => anchor.onOpen?.(send),
    (m, done, send) => {
      const v = anchor.match(m, send);
      if (!v) return;
      if ('reject' in v) {
        clearTimeout(settle);
        return done.reject(v.reject);
      }
      if ('reset' in v) {
        clearTimeout(settle);
        return;
      }
      if ('resolve' in v) {
        clearTimeout(settle);
        return done.resolve(v.resolve);
      }
      clearTimeout(settle);
      settle = setTimeout(() => done.resolve(v.settle), v.ms);
    },
    timeoutMs
  );
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
  return streamAnchored(core, {
    onOpen: send => send({ t: 'reload' }),
    match(m) {
      if (m.t === 'hello') file = m.file;
      else if (m.t === 'graph') graphs++;
      else if (m.t === 'node' && graphs >= 2) post.set(m.id, m.state.status);
      if (graphs < 2) return;
      // Snapshot arrives back-to-back after graph #2; settle once quiet.
      const status: Record<string, number> = {};
      for (const s of post.values()) status[s] = (status[s] ?? 0) + 1;
      return { settle: { file, nodes: post.size, status }, ms: 150 };
    },
  });
}

export interface SwitchResult {
  file: string;
  nodes: number;
  status: Record<string, number>;
}

/**
 * Re-point a running core at a different flow file and report the resulting
 * state. The connect burst (hello / graph #1 / snapshot / presence) is for the
 * CURRENT file; we ignore everything until our `switched` lands. On success
 * the core broadcasts `switched{ok:true}` then graph #2 + the new snapshot —
 * settle once that's quiet. On failure the core replies `switched{ok:false}`
 * to us only → reject, current flow untouched.
 */
export function sendSwitch(
  core: string,
  target: string,
  timeoutMs = 15_000
): Promise<SwitchResult> {
  let switched = false;
  let graphsAfter = 0;
  let file = '';
  const post = new Map<string, string>();
  return streamAnchored<SwitchResult>(
    core,
    {
      onOpen: send => send({ t: 'switchFile', path: target }),
      match(m) {
        if (m.t === 'switched') {
          if (!m.ok) return { reject: new Error(m.error ?? 'switch failed') };
          switched = true;
          file = m.file ?? '';
          return; // graph + snapshot follow
        }
        if (!switched) return; // pre-switch connect burst — ignore
        if (m.t === 'graph') {
          graphsAfter++;
          return;
        }
        if (m.t === 'node' && graphsAfter >= 1) post.set(m.id, m.state.status);
        if (graphsAfter < 1) return;
        const status: Record<string, number> = {};
        for (const s of post.values()) status[s] = (status[s] ?? 0) + 1;
        return { settle: { file, nodes: post.size, status }, ms: 150 };
      },
    },
    timeoutMs
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
  return streamAnchored<SetControlResult>(
    core,
    {
      onOpen: send => {
        send({ t: 'setControl', node, key, value });
        send({ t: 'query', rid, q: { kind: 'node', id: node } });
      },
      match(m) {
        if (m.t === 'node' && m.id === node) {
          if (JSON.stringify(m.state.controlState?.[key]) === want)
            return {
              resolve: {
                status: m.state.status,
                controls: m.state.controls,
                controlState: m.state.controlState,
              },
            };
          return;
        }
        if (m.t === 'queryResult' && m.rid === rid) {
          if (!m.ok) return { reject: new Error(m.error ?? 'query failed') };
          // No-op fallback: read-back is truth if no match follows shortly.
          return { settle: m.data as SetControlResult, ms: 250 };
        }
      },
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

/**
 * Whatever `nodeDetail` returns — status / summary / error / errorStack /
 * errorAt / inputDigest / ports / modulePath / moduleMtimeMs / controls /
 * … — forwarded verbatim. Loosely typed because the client just hands the
 * core's payload back out.
 */
export type ProcessResult = Record<string, unknown> & {
  status: string;
  summary?: string;
  error?: string;
};

/**
 * Run a node on a running core, settle on its terminal state, then fetch
 * the full `nodeDetail` so the caller gets the same debug surface as
 * `query node` (errorStack, errorAt, inputDigest, ports, moduleMtimeMs, …).
 * The terminal-status detection is the same quiet-beat settle as before:
 * queued/running churn cancels a pending resolve, so a pre-run `done` isn't
 * mistaken for completion. `stale` here means derivative-of-stale (an
 * upstream was stale and not rerun) — pass `rerunStale` to force.
 */
export function sendProcess(
  core: string,
  node: string,
  opts: { rerunStale?: boolean } = {},
  timeoutMs = 60_000
): Promise<ProcessResult> {
  const rid = `proc-${Date.now().toString(36)}`;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let queried = false;
  return session<ProcessResult>(
    core,
    send =>
      send({ t: 'process', node, rerunStale: opts.rerunStale === true }),
    (m, done, send) => {
      if (!queried && m.t === 'node' && m.id === node) {
        const s = m.state.status;
        clearTimeout(settleTimer);
        if (s === 'done' || s === 'stale' || s === 'error') {
          settleTimer = setTimeout(() => {
            queried = true;
            send({ t: 'query', rid, q: { kind: 'node', id: node } });
          }, 250);
        }
        return;
      }
      if (queried && m.t === 'queryResult' && m.rid === rid) {
        m.ok
          ? done.resolve(m.data as ProcessResult)
          : done.reject(new Error(m.error ?? 'query failed'));
      }
    },
    timeoutMs
  );
}

/**
 * Cancel a node's in-flight run on a running core, then settle on its terminal
 * state and fetch the full `nodeDetail` (same surface as `query node`). A
 * cancelled run lands `error: "Cancelled"`; a node that wasn't running settles
 * immediately on its current state (cancel was a no-op). Settle shape mirrors
 * `sendProcess`: a quiet beat after the last `node` broadcast, then one query.
 */
export function sendCancel(
  core: string,
  node: string,
  timeoutMs = 15_000
): Promise<ProcessResult> {
  const rid = `cancel-${Date.now().toString(36)}`;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let queried = false;
  return session<ProcessResult>(
    core,
    send => send({ t: 'cancel', node }),
    (m, done, send) => {
      if (!queried && m.t === 'node' && m.id === node) {
        const s = m.state.status;
        clearTimeout(settleTimer);
        // `idle`/`done`/`stale`/`error` are all terminal here: either the
        // cancel took effect (error) or there was nothing running to cancel.
        if (s !== 'running' && s !== 'queued') {
          settleTimer = setTimeout(() => {
            queried = true;
            send({ t: 'query', rid, q: { kind: 'node', id: node } });
          }, 250);
        }
        return;
      }
      if (queried && m.t === 'queryResult' && m.rid === rid) {
        m.ok
          ? done.resolve(m.data as ProcessResult)
          : done.reject(new Error(m.error ?? 'query failed'));
      }
    },
    timeoutMs
  );
}

/**
 * Deliver one free-form control event to a running node — exactly as a
 * connected UI client's shim would (`{ t: 'controlEvent', node, event,
 * payload }`). The core invokes `node.control.event(ctx, { event, payload })`,
 * then re-derives `control.data` and re-streams `controlData`/HTML. Whether
 * the graph ages is the *handler's* call, unchanged: a handler that runs
 * `ctx.markStale()` (e.g. `merge_done`) ages the node + its downstream; one
 * that doesn't (e.g. `cell_edit`, `seed_rows`) is pure presentation. The CLI
 * imposes no execution-model change — it only delivers the event; pull stays
 * the sole compute trigger.
 *
 * The settle-then-query shape is `sendProcess`'s: every `node` broadcast for
 * the target re-arms a quiet beat (the connect-burst snapshot first, then the
 * post-event re-derive), and the read-back query is sent only once the stream
 * is quiet, so the returned `nodeDetail` reflects the post-event state for any
 * realistically-fast handler + `control.data`. A node with no free-form
 * control (or no handler for `event`) is a no-op on the data side (only the
 * burst snapshot broadcasts; `controlData` stays absent).
 */
export function sendControlEvent(
  core: string,
  node: string,
  event: string,
  payload?: unknown,
  timeoutMs = 10_000
): Promise<ProcessResult> {
  const rid = `cev-${Date.now().toString(36)}`;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let queried = false;
  return session<ProcessResult>(
    core,
    send => send({ t: 'controlEvent', node, event, payload }),
    (m, done, send) => {
      if (!queried && m.t === 'node' && m.id === node) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          queried = true;
          send({ t: 'query', rid, q: { kind: 'node', id: node } });
        }, 300);
        return;
      }
      if (queried && m.t === 'queryResult' && m.rid === rid) {
        m.ok
          ? done.resolve(m.data as ProcessResult)
          : done.reject(new Error(m.error ?? 'query failed'));
      }
    },
    timeoutMs
  );
}

/**
 * Re-derive a node's free-form control out of band — re-run `control.data`,
 * re-render, re-stream `controlData`/HTML to every client — WITHOUT a pull
 * (no `process()`, no graph aging, no status change). The cheap refresh the
 * agent fires after writing the node's own durable file directly (e.g. an
 * annotation JSONL), so the human's live control reflects the write without a
 * re-fold.
 *
 * This is sugar for the reserved `$mount` control event, which the core
 * handles by skipping the handler and just re-deriving + streaming
 * (controls-render.ts) — i.e. `sendControlEvent(core, node, '$mount')`.
 * Kept as a named verb so the `$mount` sentinel stays an internal detail.
 */
export function sendRefreshControl(
  core: string,
  node: string,
  timeoutMs = 10_000
): Promise<ProcessResult> {
  return sendControlEvent(core, node, '$mount', undefined, timeoutMs);
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
  return streamAnchored<SuggestResult>(
    core,
    {
      onOpen: send =>
        send({ t: 'presence', client: label, data: { label, changeSet } }),
      match(m) {
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
          if (hit) return { resolve: { verdict: hit.verdict, by: c.client } };
        }
      },
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
  return streamAnchored<CalloutResult>(
    core,
    {
      onOpen: send =>
        send({ t: 'presence', client: label, data: { label, callouts: [c] } }),
      match(m) {
        if (m.t === 'hello') {
          me = m.clientId;
          return;
        }
        if (m.t !== 'presence') return;
        for (const peer of m.clients) {
          if (peer.id === me) continue;
          const echoed = peer.data?.calloutLabels?.[internalId];
          if (echoed) return { resolve: { label: echoed, internalId } };
        }
      },
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
  return streamAnchored<{ dismissedId: string; acked: boolean }>(
    core,
    {
      // Deferred — we send from `match` after resolving the label.
      match(m, send) {
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
            if (!resolveId)
              return {
                reject: new Error(
                  `no callout matching label ${idOrLabel} — known labels are in the editor's calloutLabels (try \`cocoon presence\`).`
                ),
              };
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
          if (Array.isArray(dl) && dl.includes(resolveId!))
            return { resolve: { dismissedId: resolveId!, acked: true } };
        }
      },
    },
    timeoutMs
  ).catch(err => {
    // No editor to ack — surface as `acked:false`, not an error.
    if (err instanceof Error && /did not respond within/.test(err.message))
      return { dismissedId: resolveId ?? idOrLabel, acked: false };
    throw err;
  });
}

export interface ErrorEvent {
  /** Node id (the WS broadcast carries no command "kind" — that lives in
   *  serve's catch arms — so we just report which node entered error). */
  id: string;
  message: string;
  /** Per-node stack captured by `runOne`'s catch; absent only when the node
   *  state has none (load errors surface as `error` without a stack). */
  stack?: string;
}

/**
 * Stream `error`-status transitions from the live core. The connect burst
 * populates a baseline (status snapshots are not emitted as events); from
 * the `presence` frame onward, any node transitioning into `error` fires
 * `onError`. Resolves cleanly when the core disconnects.
 *
 * Works for any client — agent-launched core OR human-launched core. The
 * stable contract on top of the per-node state broadcast that already
 * carries `errorStack`, replacing the brittle stderr-tail recipe.
 */
export function streamErrors(
  core: string,
  onError: (e: ErrorEvent) => void
): Promise<void> {
  const last = new Map<string, string>();
  let live = false;
  return new Promise<void>((resolve, reject) => {
    const url = normalizeCore(core);
    const ws = new WebSocket(url);
    let opened = false;
    ws.on('open', () => {
      opened = true;
    });
    ws.on('error', (e: Error) =>
      reject(
        opened
          ? e
          : new CoreUnreachable(
              `no core at ${url} (${e.message}). Is \`cocoon serve\` running?`
            )
      )
    );
    ws.on('close', () => resolve());
    ws.on('message', raw => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(raw)) as ServerMessage;
      } catch {
        return;
      }
      // `presence` is sent at the end of the connect burst (even when empty);
      // use it as the boundary between baseline and live mode.
      if (m.t === 'presence' && !live) {
        live = true;
        return;
      }
      if (m.t !== 'node') return;
      const prev = last.get(m.id);
      const next = m.state.status;
      last.set(m.id, next);
      if (!live) return;
      if (next === 'error' && prev !== 'error') {
        onError({
          id: m.id,
          message: m.state.error ?? 'unknown error',
          stack: m.state.errorStack,
        });
      }
    });
  });
}

export { CoreUnreachable };
