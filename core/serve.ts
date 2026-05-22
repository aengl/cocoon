/**
 * WebSocket frontend for the editor. The editor is a pure viewer: it gets the
 * file verbatim (it runs its own lossless loader) plus a stream of node-state
 * updates, and sends back only `process` / `invalidate` commands.
 *
 * This is a thin adapter — the same Runtime is what the headless CLI uses.
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

/** Editor's built bundle, sibling to `core/`. Undefined if `pnpm build` hasn't
 *  run — the core still serves the WS, just no UI. */
const distDir = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '..', 'dist');
  return fs.existsSync(path.join(candidate, 'index.html'))
    ? candidate
    : undefined;
})();

export async function serve(filePath: string, port = 22242) {
  const rt = await Runtime.load(filePath);

  // One HTTP server carrying BOTH the WS (editor data stream) and the
  // control-render-code delivery seam (keystone 2/5). `GET /hook/<type>` →
  // the esbuild-bundled browser `hook` of that node's co-located module,
  // resolved by convention (no registry), mtime-cached (the resolver's
  // `?m=<mtime>` browser twin). CORS-open: the editor (Vite :5173) and the
  // core (:<port>) are different origins; a dev tool, like the WS itself.
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
          // Loud, parseable: the editor's dynamic import rejects and the
          // node simply shows its inert HTML without the hook.
          console.error(`hook bundle "${type}" failed:`, err?.message ?? err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.end(
            `// hook bundle failed: ${String(err?.message ?? err).replace(/\n/g, ' ')}`
          );
        });
      return;
    }
    // Editor static bundle (Vite `pnpm build` output). Same-origin with the
    // WS keeps the user-facing setup a single command and a single URL; dev
    // (Vite :5173) is the contributor mode only. Missing dist/ → fall through
    // to the inert "cocoon core" 404 so the WS keeps working headless.
    if ((req.method === 'GET' || req.method === 'HEAD') && distDir) {
      const reqPath = decodeURIComponent(u.pathname);
      const candidate = reqPath === '/' ? '/index.html' : reqPath;
      const abs = path.normalize(path.join(distDir, candidate));
      // Path-traversal guard: anything that resolves outside dist/ falls back
      // to index.html (SPA route).
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
  // `listen()` is async; without an error handler an EADDRINUSE arrives as
  // an unhandled 'error' event and crashes the process *after* the success
  // log has already printed. Catch on both the httpServer and the wss
  // (which re-emits the underlying socket's errors).
  const onListenError = (err: unknown) => {
    console.error(`cocoon core: ${(err as Error).message}`);
    process.exit(1);
  };
  httpServer.on('error', onListenError);
  wss.on('error', onListenError);
  httpServer.listen(port);
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

  /**
   * Re-read the flow and repaint every client (the editor included) — the
   * single reload path, shared by the explicit `{t:'reload'}` message and the
   * file watcher below. Selective by default (keystone-6); `fullReset` is the
   * editor toolbar's deliberate "recompute everything" (never the per-save
   * watcher). A failed reload (a half-written mid-save file) is a complete
   * no-op in `rt.reload()` and just logs here; the next debounced fire wins,
   * so the last good graph stays on screen.
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

  // Restore persisted nodes from disk in the background. The WebSocket server
  // is already listening, so the editor opens immediately with everything
  // `idle` and each persisted node lights up to `done` (streamed via the
  // listener above) as its cache finishes — legacy "they stream in", not the
  // freeze that blocking `Runtime.load()` on a 542 MiB parse caused.
  void rt.hydrate();

  // Watch the flow file itself. cocoon.yml is hand-edited in a real
  // side-by-side text editor (keystone 3 — the graph editor is a pure
  // viewer, no in-app text editor); a save must repaint the graph WITHOUT a
  // manual `cocoon reload`. This is the *wiring* watcher and lives here in
  // the transport layer (never in Runtime — exactly like presence): headless
  // one-shot `run` has no clients and must not arm it. It does NOT contradict
  // keystone 6's "no watcher": that bars a watcher on node *module code*
  // (resolved pull-triggered/mtime-hot at execution time — a deliberately
  // different, computation-bearing concern). Reloading *wiring* runs nothing
  // (re-parse → reset → hydrate), has no natural pull trigger, and — since
  // the core never writes the flow file (no save path) — needs none of
  // legacy's unwatch/rewatch self-write guard. `fs.watchFile` (polling),
  // legacy-faithful and zero-dep: it stats the path, so it survives an
  // editor's atomic save/rename, unlike `fs.watch`.
  const watched = path.resolve(rt.filePath);
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const onFileChange = (curr: fs.Stats, prev: fs.Stats) => {
    // `watchFile` polls every `interval`; act only on a real content change
    // (skip atime-only / no-op polls), then debounce a save burst (editors
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
        // The AI (or a human via `cocoon reload`) edited the flow on disk and
        // asked for an explicit re-read — selective, like the file watcher.
        // `reset:true` (the editor's toolbar ↻ only) forces the full reset:
        // a deliberate, rare, user-initiated "recompute everything".
        void reloadAndBroadcast(msg.reset === true);
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
    `cocoon core: ${path.basename(rt.filePath)}  ·  http://localhost:${port}${
      distDir ? '' : '  (no editor bundle; run `pnpm build`)'
    }`
  );
  // Returned so embedders/tests can shut the server down; the CLI ignores it
  // and the process simply stays alive on the listening socket.
  return { wss, rt };
}
