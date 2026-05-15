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
  ServerMessage,
} from '../src/lib/protocol.ts';
import { Runtime } from './runtime.ts';

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
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  console.error(
    `cocoon core: ${path.basename(rt.filePath)}  ·  ws://localhost:${port}`
  );
}
