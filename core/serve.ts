/**
 * WebSocket + HTTP frontend. The editor receives the file verbatim plus a
 * stream of per-node state, and sends back commands. Same `Runtime` as the
 * headless CLI; this module is a thin adapter.
 */
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { bundleHook } from './control-hook-bundle.ts';
import type {
  ClientMessage,
  Query,
  ServerMessage,
} from '../src/lib/protocol.ts';
import { nodeDetail, overview, relatives } from './introspect.ts';
import { PresenceHub } from './presence.ts';
import { Runtime } from './runtime.ts';

/**
 * EADDRINUSE handler: probe the existing listener via WS for its `hello.file`.
 * If it's a cocoon core serving the same absolute path, attach (exit 0). If
 * it's a cocoon core serving something else, name the conflict and exit 1.
 * If no hello arrives, treat as "something else owns the port" and exit 1.
 */
async function handleAddrInUse(port: number, ourFile: string): Promise<void> {
  const want = path.resolve(ourFile);
  const url = `ws://localhost:${port}`;
  let exit = 1;
  let msg = `cocoon core: port ${port} in use (probe timed out)`;
  try {
    const file = await probeFile(url, 2000);
    if (file == null) {
      msg = `cocoon core: port ${port} in use (not a cocoon core)`;
    } else if (path.resolve(file) === want) {
      msg = `cocoon core: attached to ${path.basename(want)}  ·  http://localhost:${port}`;
      exit = 0;
    } else {
      msg = `cocoon core: port ${port} in use by core serving ${file}`;
    }
  } catch (err) {
    msg = `cocoon core: port ${port} in use (${(err as Error).message})`;
  }
  console.error(msg);
  process.exit(exit);
}

function probeFile(url: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(null);
    }, timeoutMs);
    ws.on('message', raw => {
      try {
        const m = JSON.parse(String(raw)) as { t?: string; file?: string };
        if (m.t === 'hello' && typeof m.file === 'string') {
          clearTimeout(timer);
          ws.terminate();
          resolve(m.file);
        }
      } catch {
        /* malformed frame — keep waiting */
      }
    });
    ws.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Per-command failure log to stderr — formatted so a Monitor watching
 * stderr gets node id, kind, and stack in one batched notification, with
 * no further `query node` round-trip needed for the common case.
 *
 * For `process` failures the meaningful stack lives on the node's state
 * (captured by `runOne`'s catch); the outer `err` here is the scheduler's
 * synthetic "Cannot process X: …" wrapper that has no useful frames.
 */
function logFailure(
  rt: Runtime,
  kind: string,
  node: string,
  err: unknown
): void {
  console.error(`${kind} "${node}" failed`);
  const innerStack = rt.errorStackOf(node);
  const outer = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(innerStack ?? outer);
}

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
  // EADDRINUSE gets a friendlier path: probe the existing listener, and if
  // it's a cocoon core already serving the same file, attach (exit 0). The
  // dance lets an agent run `cocoon serve <file>` unconditionally without
  // a pre-check.
  const onListenError = (err: unknown) => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      void handleAddrInUse(port, rt.filePath);
      return;
    }
    console.error(`cocoon core: ${e.message}`);
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
          err => logFailure(rt, 'process', msg.node, err)
        );
      } else if (msg.t === 'invalidate') {
        rt.invalidate(msg.node);
      } else if (msg.t === 'setPersist') {
        rt.setPersist(msg.node, msg.value).catch(err =>
          logFailure(rt, 'setPersist', msg.node, err)
        );
      } else if (msg.t === 'setControl') {
        rt.setControl(msg.node, msg.key, msg.value).catch(err =>
          logFailure(rt, 'setControl', msg.node, err)
        );
      } else if (msg.t === 'controlEvent') {
        rt.controlEvent(msg.node, msg.event, msg.payload).catch(err =>
          logFailure(rt, 'controlEvent', msg.node, err)
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
