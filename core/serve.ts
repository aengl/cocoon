/**
 * WebSocket + HTTP frontend. The editor receives the file verbatim plus a
 * stream of per-node state, and sends back commands. Same `Runtime` as the
 * headless CLI; this module is a thin adapter.
 */
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { bundleHook } from './control-hook-bundle.ts';
import type {
  ClientMessage,
  Query,
  ServerMessage,
} from '../src/lib/protocol.ts';
import { nodeDetail, overview, relatives } from './introspect.ts';
import { PresenceHub } from './presence.ts';
import { Runtime } from './runtime.ts';

/** Dispatch a read-only `query` to the introspect layer. */
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
        expand: q.expand,
      });
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Editor bundle; `undefined` if `pnpm build` hasn't run — the WS still
 *  works headless. */
const distDir = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '..', 'dist');
  return fs.existsSync(path.join(candidate, 'index.html'))
    ? candidate
    : undefined;
})();

export async function serve(filePath: string, port = 22242) {
  const rt = await Runtime.load(filePath);

  // One HTTP server carries the WS (state stream) AND `GET /hook/<type>`,
  // which serves the esbuild-bundled browser `hook` of that node's
  // co-located module. CORS-open: dev mode runs the editor on Vite :5173,
  // a different origin from the core.
  const httpServer = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && u.pathname.startsWith('/hook/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const type = decodeURIComponent(u.pathname.slice('/hook/'.length));
      const file = rt.controlHookFile(type);
      if (!file) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(`// no control hook for "${type}"`);
        return;
      }
      bundleHook(file)
        .then(code => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(code);
        })
        .catch(err => {
          // Editor's dynamic import rejects; node still shows inert HTML.
          console.error(`hook bundle "${type}" failed:`, err?.message ?? err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.end(
            `// hook bundle failed: ${String(err?.message ?? err).replace(/\n/g, ' ')}`
          );
        });
      return;
    }
    // Editor static bundle. Missing dist/ falls through to a 404 so the
    // WS keeps working headless.
    if ((req.method === 'GET' || req.method === 'HEAD') && distDir) {
      const reqPath = decodeURIComponent(u.pathname);
      const candidate = reqPath === '/' ? '/index.html' : reqPath;
      const abs = path.normalize(path.join(distDir, candidate));
      // Path-traversal guard: anything outside dist/ falls back to
      // index.html (SPA route).
      const inDist = abs === distDir || abs.startsWith(distDir + path.sep);
      const file = inDist && fs.existsSync(abs) && fs.statSync(abs).isFile()
        ? abs
        : path.join(distDir, 'index.html');
      if (fs.existsSync(file)) {
        res.statusCode = 200;
        res.setHeader('Content-Type', mimeFor(file));
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    res.statusCode = 404;
    res.end('cocoon core');
  });
  const wss = new WebSocketServer({ server: httpServer });
  // Without an error handler, an EADDRINUSE arrives as an unhandled 'error'
  // and crashes the process AFTER the success log has already printed.
  // Catch on both httpServer and wss (which re-emits socket errors).
  const onListenError = (err: unknown) => {
    console.error(`cocoon core: ${(err as Error).message}`);
    process.exit(1);
  };
  httpServer.on('error', onListenError);
  wss.on('error', onListenError);
  httpServer.listen(port);
  const clients = new Set<WebSocket>();
  // Presence is orthogonal to Runtime — processing is unaffected by who's
  // watching. See core/presence.ts.
  const presence = new PresenceHub();

  const send = (ws: WebSocket, msg: ServerMessage) =>
    ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  const broadcastPresence = () => {
    const msg: ServerMessage = { t: 'presence', clients: presence.snapshot() };
    for (const ws of clients) send(ws, msg);
  };

  /**
   * Re-read the flow and repaint every client. Shared by `{t:'reload'}` and
   * the file watcher. `fullReset` is the toolbar's "recompute everything"
   * (never the watcher). A failed reload is a no-op in `rt.reload()`; the
   * next watcher fire wins, so the last good graph stays on screen.
   */
  const reloadAndBroadcast = (fullReset = false) =>
    rt
      .reload({ fullReset })
      .then(() => {
        for (const c of clients) {
          send(c, { t: 'graph', yaml: rt.yaml });
          for (const [id, state] of rt.snapshot())
            send(c, { t: 'node', id, state });
        }
      })
      .catch(err => console.error('reload failed:', err.message));

  rt.onState((id, state) => {
    const msg: ServerMessage = { t: 'node', id, state };
    for (const ws of clients) send(ws, msg);
  });

  // Restore persisted nodes from disk in the background. The WS is already
  // listening, so the editor opens immediately and each persisted node
  // lights up to `done` as its cache finishes — never blocks on a big parse.
  void rt.hydrate();

  // Watch the flow file. Lives at the transport layer, not in Runtime: the
  // headless one-shot `run` has no clients and must not arm a watcher.
  // `fs.watchFile` polls a path (not an inode), so it survives an editor's
  // atomic save/rename.
  const watched = path.resolve(rt.filePath);
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const onFileChange = (curr: fs.Stats, prev: fs.Stats) => {
    // Skip no-op polls (atime-only), then debounce a save burst (editors
    // write in several syscalls) into one reload.
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reloadAndBroadcast(), 150);
  };
  fs.watchFile(watched, { interval: 300 }, onFileChange);
  wss.on('close', () => {
    clearTimeout(reloadTimer);
    fs.unwatchFile(watched, onFileChange);
  });

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
        rt.process(msg.node, { rerunStale: msg.rerunStale === true }).catch(
          err => console.error(`process "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'invalidate') {
        rt.invalidate(msg.node);
      } else if (msg.t === 'setPersist') {
        rt.setPersist(msg.node, msg.value).catch(err =>
          console.error(`setPersist "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'setControl') {
        rt.setControl(msg.node, msg.key, msg.value).catch(err =>
          console.error(`setControl "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'controlEvent') {
        rt.controlEvent(msg.node, msg.event, msg.payload).catch(err =>
          console.error(`controlEvent "${msg.node}" failed:`, err.message)
        );
      } else if (msg.t === 'reload') {
        // `reset:true` is the toolbar's "recompute everything"; otherwise
        // selective, like the file watcher.
        void reloadAndBroadcast(msg.reset === true);
      } else if (msg.t === 'presence') {
        // Oversized/non-serialisable blobs are silently dropped.
        if (presence.set(connId, msg.client, msg.data)) broadcastPresence();
      } else if (msg.t === 'query') {
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
      if (presence.drop(connId)) broadcastPresence();
    });
  });

  console.error(
    `cocoon core: ${path.basename(rt.filePath)}  ·  http://localhost:${port}${
      distDir ? '' : '  (no editor bundle; run `pnpm build`)'
    }`
  );
  // Returned so embedders/tests can close the server; the CLI ignores it.
  return { wss, rt };
}
