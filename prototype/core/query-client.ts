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
  Callout,
  ChangeSet,
  ClientMessage,
  PresenceEntry,
  Query,
  ServerMessage,
  SuggestionVerdict,
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

interface SetControlResult {
  status: string;
  controls?: Record<string, unknown>;
  controlState?: Record<string, unknown>;
}

/**
 * Set one steering control and report the authoritative resulting node state.
 *
 * `setControl` has no correlated ack (the `setPersist` twin); its effect is a
 * session override that ages the node `stale` and re-streams the effective
 * `controlState`. Reading it back is subtle: serve.ts handles back-to-back WS
 * frames in *one* macrotask, and `Runtime.setControl` updates the streamed
 * state only *after* its `markStale` await — so a `query node` sent in the
 * same batch is answered with the *pre-set* state (it races the override's
 * own broadcast). We therefore anchor on that broadcast, the way `sendReload`
 * anchors on the second `graph`:
 *
 *  - a *valid* `setControl` ends in `Runtime.setControl`'s `controlPatch`
 *    `set`, which re-broadcasts the target `node` carrying the *new*
 *    `controlState`. We resolve on the first such broadcast whose
 *    `controlState[key]` actually equals the requested value — NOT a
 *    positional count: when the node was `done`, `markStale` fires its own
 *    earlier `{status:'stale'}` broadcast that still has the *old* value, so
 *    "the 2nd node message" is the wrong anchor. Value-match is the only
 *    timing-free, broadcast-count-independent signal;
 *  - a documented silent no-op (unknown node/key, wrong-shaped value, or a
 *    schema not yet resolved because the node never ran) never produces a
 *    matching broadcast. The parallel correlated `query node` — which always
 *    replies — is the fallback: if it lands and no match follows within a
 *    short settle, we resolve from it (the override genuinely didn't take,
 *    and the unchanged `controlState` says so).
 */
export function sendSetControl(
  core: string,
  node: string,
  key: string,
  value: unknown,
  timeoutMs = 10_000
): Promise<SetControlResult> {
  const rid = `cli-${Date.now().toString(36)}`;
  const want = JSON.stringify(value); // deep-eq the streamed effective value
  let queried: SetControlResult | undefined; // stashed correlated read-back
  let settle: ReturnType<typeof setTimeout> | undefined;
  return session<SetControlResult>(
    core,
    send => {
      send({ t: 'setControl', node, key, value });
      send({ t: 'query', rid, q: { kind: 'node', id: node } });
    },
    (m, done) => {
      if (m.t === 'node' && m.id === node) {
        // The authoritative signal: a broadcast whose effective value is
        // the one we asked for (the controlPatch `set`, not markStale's
        // earlier old-value status flip).
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
        // No-op fallback: if no matching broadcast follows shortly, the
        // read-back is the truth (override didn't take — unchanged state).
        clearTimeout(settle);
        settle = setTimeout(() => done.resolve(queried!), 250);
      }
    },
    timeoutMs
  );
}

/**
 * One-shot read of the live presence snapshot — "who else is here and what
 * are they looking at / typing". The core sends a `presence` frame in the
 * connect burst (right after the node snapshot), so we just resolve the first
 * one. By default the caller's own (non-announcing) connection isn't in it;
 * we still drop any entry matching our `hello.clientId` for safety.
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
 * Trigger a node run on a *running* core (the editor's live session — not a
 * fresh headless Runtime like `cocoon run`) and resolve once the target
 * reaches a terminal state. `process` has no correlated ack (the `setControl`
 * twin), so we anchor on the streamed `{t:'node',id:target}` broadcasts: the
 * target moves idle/stale → queued → running → done|error (a green target
 * re-runs — "run to here" is a direct request, per the execution model). We
 * resolve on a terminal status that *settles* (no further target broadcast
 * for a beat), so the queued/running churn — and a stale pre-run `done` — is
 * ridden out rather than mistaken for completion.
 */
export function sendProcess(
  core: string,
  node: string,
  timeoutMs = 60_000
): Promise<ProcessResult> {
  let settle: ReturnType<typeof setTimeout> | undefined;
  let last: ProcessResult | undefined;
  return session<ProcessResult>(
    core,
    send => send({ t: 'process', node }),
    (m, done) => {
      if (m.t !== 'node' || m.id !== node) return;
      last = {
        status: m.state.status,
        summary: m.state.summary,
        error: m.state.error,
      };
      if (m.state.status === 'done' || m.state.status === 'error') {
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
 * Announce a change-set as *our own presence* and stay connected until a peer
 * (the editor) reports a verdict for it — the suggestion model: the agent is
 * just another client, the response rides the same presence channel, the core
 * stays a dumb relay. On resolve we disconnect, so the suggestion presence
 * evaporates naturally (it was answered). Human-in-loop, so the default
 * timeout is generous.
 *
 * Resolution is value-matched, not positional (same discipline as
 * `sendSetControl`): we scan every *other* client's `resolvedSuggestions` for
 * our `changeSet.id`. Re-announcing the same id from the editor side would
 * supersede; here we only ever announce once.
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
        if (c.id === me) continue; // never our own echo
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
  /** The short, chat-friendly label the editor assigned (`C1`, `C2`, …).
   *  Undefined if no editor was present to assign one within `ackTimeoutMs`. */
  label?: string;
  /** The opaque internal id we announced (the same one passed in or
   *  auto-generated). Stable for later re-announce / dismissal lookups. */
  internalId: string;
}

/**
 * Announce a callout as the agent's *own presence* — fire-and-forget by
 * design. Unlike `suggest()` we don't wait for a verdict (a callout has no
 * answer to wait on — the human's reply belongs in chat, not the editor).
 * We wait briefly only for the editor's label echo (`calloutLabels[id]`) so
 * the CLI can print the chat-friendly `C…` label and exit. Then we
 * disconnect — but the marker survives, because the editor snapshots
 * callouts on first observation into its own local state (see
 * `protocol.ts` `Callout` for the lifetime model). The connection-keyed
 * presence don't-list still holds; this is the editor doing the keeping,
 * not the core.
 *
 * If no editor is around the label echo never arrives — that's not an
 * error, just an empty `label`. The agent can re-announce later (same id)
 * once an editor connects; the editor will then assign and echo a label.
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
    // Timeout is the *expected* "no editor here" path; surface it as an
    // empty-label result instead of an error so the CLI can print and exit
    // cleanly. Anything else (CoreUnreachable, ws error) keeps propagating.
    if (err instanceof Error && /did not respond within/.test(err.message))
      return { internalId };
    throw err;
  });
}

/**
 * Dismiss one of the agent's own callouts from the agent side — the symmetric
 * twin of the human's ✕ in the editor. Announces a presence frame with
 * `dismissedCallouts: [internalId]` and waits briefly for the editor to echo
 * the id back in *its* `dismissedCallouts` (confirming snapshot update). The
 * core's broadcast is synchronous on its side, so on timeout we still resolve
 * cleanly — the editor will have received the frame regardless; the echo is
 * only there to ack that the editor *processed* it.
 *
 * `idOrLabel` may be the opaque internal id (`co-…`) the announce returned,
 * or the chat-friendly short label (`C1`, `C2`, …) the editor assigned —
 * resolved against the editor's `calloutLabels` from peer presence on the
 * connect-burst snapshot. An unknown label is a hard error (otherwise a
 * stale `C…` would silently no-op).
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
        // Resolve label→internal id on the first presence snapshot (the
        // connect-burst broadcast contains every peer's labels map).
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
        return; // wait for an echo, or fall through to the timeout fallback
      }
      // Look for our id in any peer's dismissedCallouts — confirms the
      // editor processed our announce.
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
    // No editor here to ack: the announce frame still flushed via the core
    // (synchronous broadcast on its side), so if a later editor session
    // doesn't snapshot the dismissal it's because the snapshot only happens
    // on first observation of the callout itself — fine, the agent re-fires
    // intentionally. Surface as `acked:false` instead of failing (parallels
    // the empty-label fallback in `callout()`).
    if (err instanceof Error && /did not respond within/.test(err.message))
      return { dismissedId: resolveId ?? idOrLabel, acked: false };
    throw err;
  });
}

export { CoreUnreachable };
