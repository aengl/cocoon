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

  const send = (ws: WebSocket, msg: ServerMessage) =>
    ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  rt.onState((id, state) => {
    const msg: ServerMessage = { t: 'node', id, state };
    for (const ws of clients) send(ws, msg);
  });

  wss.on('connection', ws => {
    clients.add(ws);
    send(ws, { t: 'hello', file: path.basename(rt.filePath) });
    send(ws, { t: 'graph', yaml: rt.yaml });
    for (const [id, state] of rt.snapshot())
      send(ws, { t: 'node', id, state });

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

    ws.on('close', () => clients.delete(ws));
  });

  console.error(
    `cocoon core: ${path.basename(rt.filePath)}  ·  ws://localhost:${port}`
  );
  // Returned so embedders/tests can shut the server down; the CLI ignores it
  // and the process simply stays alive on the listening socket.
  return { wss, rt };
}
