/**
 * WebSocket frontend for the editor. The editor is a pure viewer: it gets the
 * file verbatim (it runs its own lossless loader) plus a stream of node-state
 * updates, and sends back only `process` / `invalidate` commands.
 *
 * This is a thin adapter — the same Runtime is what the headless CLI uses.
 */
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  ClientMessage,
  Query,
  ServerMessage,
} from '../src/lib/protocol.ts';
import { nodeDetail, overview, relatives } from './introspect.ts';
import { PresenceHub } from './presence.ts';
import { Runtime } from './runtime.ts';

/** Dispatch a read-only `query` to the transport-agnostic introspect layer. */
function runQuery(rt: Runtime, q: Query): unknown {
  switch (q.kind) {
    case 'overview':
      return overview(rt);
    case 'node':
      return nodeDetail(rt, q.id);
    case 'upstream':
      return relatives(rt, q.id, 'up', q.depth);
    case 'downstream':
      return relatives(rt, q.id, 'down', q.depth);
    case 'peek':
      return rt.peek(q.uri, {
        descend: q.descend,
        where: q.where,
        select: q.select,
        limit: q.limit,
      });
  }
}

export async function serve(filePath: string, port = 4000) {
  const rt = await Runtime.load(filePath);
  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();
  // Presence: an optional, orthogonal side-channel (see core/presence.ts).
  // The Runtime never sees it — processing is unaffected by who's watching.
  const presence = new PresenceHub();

  const send = (ws: WebSocket, msg: ServerMessage) =>
    ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  /** Rebroadcast the full presence snapshot to everyone (it's tiny). */
  const broadcastPresence = () => {
    const msg: ServerMessage = { t: 'presence', clients: presence.snapshot() };
    for (const ws of clients) send(ws, msg);
  };

  rt.onState((id, state) => {
    const msg: ServerMessage = { t: 'node', id, state };
    for (const ws of clients) send(ws, msg);
  });

  // Restore persisted nodes from disk in the background. The WebSocket server
  // is already listening, so the editor opens immediately with everything
  // `idle` and each persisted node lights up to `done` (streamed via the
  // listener above) as its cache finishes — legacy "they stream in", not the
  // freeze that blocking `Runtime.load()` on a 542 MiB parse caused.
  void rt.hydrate();

  wss.on('connection', ws => {
    clients.add(ws);
    const connId = presence.newConnId();
    send(ws, { t: 'hello', file: path.resolve(rt.filePath), clientId: connId });
    send(ws, { t: 'graph', yaml: rt.yaml });
    for (const [id, state] of rt.snapshot())
      send(ws, { t: 'node', id, state });
    // Existing peers, so a fresh client sees who's already here.
    send(ws, { t: 'presence', clients: presence.snapshot() });

    ws.on('message', raw => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === 'process') {
        rt.process(msg.node).catch(err =>
          console.error(`process "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'invalidate') {
        rt.invalidate(msg.node);
      } else if (msg.t === 'setPersist') {
        rt.setPersist(msg.node, msg.value).catch(err =>
          console.error(`setPersist "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'setControl') {
        // Steering: a session override, ages the node + downstream, no
        // upstream pull / cascade (Runtime.setControl owns that contract).
        rt.setControl(msg.node, msg.key, msg.value).catch(err =>
          console.error(`setControl "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'controlEvent') {
        // Free-form control (LiveView model): the node's `control.event`
        // interprets it; the re-rendered HTML streams back in node-state.
        rt.controlEvent(msg.node, msg.event, msg.payload).catch(err =>
          console.error(`controlEvent "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'reload') {
        // The AI edited the flow on disk. Re-read it, then re-broadcast the
        // graph + a fresh snapshot so EVERY client (the editor included)
        // repaints — the "fix it, watch it light up" loop.
        rt.reload()
          .then(() => {
            for (const c of clients) {
              send(c, { t: 'graph', yaml: rt.yaml });
              for (const [id, state] of rt.snapshot())
                send(c, { t: 'node', id, state });
            }
          })
          .catch(err => console.error('reload failed:', err.message));
      } else if (msg.t === 'presence') {
        // Optional side-channel: store this connection's opaque blob and
        // rebroadcast. The core interprets nothing (see core/presence.ts);
        // an oversized/garbage blob is silently dropped, never fatal.
        if (presence.set(connId, msg.client, msg.data)) broadcastPresence();
      } else if (msg.t === 'query') {
        // Read-only; reply only to the asker, correlated by `rid`. Bounded
        // by introspect.ts — never bulk port data.
        try {
          send(ws, { t: 'queryResult', rid: msg.rid, ok: true, data: runQuery(rt, msg.q) });
        } catch (err) {
          send(ws, {
            t: 'queryResult',
            rid: msg.rid,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      // Presence evaporates with the connection (the whole lifetime model).
      if (presence.drop(connId)) broadcastPresence();
    });
  });

  console.error(
    `cocoon core: ${path.basename(rt.filePath)}  ·  ws://localhost:${port}`
  );
  // Returned so embedders/tests can shut the server down; the CLI ignores it
  // and the process simply stays alive on the listening socket.
  return { wss, rt };
}
