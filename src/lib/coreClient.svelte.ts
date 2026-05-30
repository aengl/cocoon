/**
 * The editor's connection to a core. The editor is a pure viewer: it never
 * holds bulk data, only the file (loaded losslessly itself) and a stream of
 * per-node state.
 *
 * Also a presence client: it announces an opaque blob of its own ephemeral
 * UI state and observes peers' — the human↔AI collaboration channel. The
 * core relays presence and interprets nothing; nothing in processing depends
 * on it.
 *
 * `.svelte.ts` so the connection state is reactive across the app.
 */
import type {
  NodeState,
  PresenceData,
  PresenceEntry,
  ServerMessage,
} from './protocol';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

// Same origin in production (the core serves the bundle); :22242 in dev.
const defaultWsUrl =
  import.meta.env.PROD && typeof location !== 'undefined'
    ? `ws://${location.host}`
    : 'ws://localhost:22242';

export function createCore(defaultUrl = defaultWsUrl) {
  let status = $state<ConnStatus>('disconnected');
  let url = $state(defaultUrl);
  let file = $state<string | undefined>();
  let yaml = $state<string | undefined>();
  let nodeStates = $state<Record<string, NodeState>>({});
  let clientId = $state<string | undefined>();
  let peers = $state<PresenceEntry[]>([]);
  // Cross-session "recently served flows" for the path-switch dropdown; the
  // core supplies it (the viewer can't read the filesystem) in `hello` and
  // updates it on every `switched`.
  let recents = $state<string[]>([]);
  // The core's home dir, so the editor can show paths as `~/…` (wire paths
  // stay absolute). Constant per core; (re)set from `hello`.
  let home = $state<string | undefined>();
  // Last `switchFile` failure (file gone / parse error), shown transiently in
  // the header. Cleared on the next successful switch / reconnect.
  let switchError = $state<string | undefined>();
  let switchErrorTimer: ReturnType<typeof setTimeout> | undefined;
  let ws: WebSocket | undefined;

  // Outbound presence accumulator. Held outside `$state` — only inbound
  // `peers` needs reactivity.
  let mine: PresenceData = {};
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  function sendPresenceNow() {
    flushTimer = undefined;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({ t: 'presence', client: 'editor', data: mine })
      );
  }

  function connect(next = url) {
    url = next;
    ws?.close();
    status = 'connecting';
    nodeStates = {};
    yaml = undefined;
    file = undefined;
    clientId = undefined;
    peers = [];
    recents = [];
    home = undefined;
    switchError = undefined;
    try {
      ws = new WebSocket(url);
    } catch {
      status = 'disconnected';
      return;
    }
    ws.onopen = () => {
      status = 'connected';
      // Re-announce on reconnect so we don't go dark to peers.
      if (Object.keys(mine).length) sendPresenceNow();
    };
    ws.onclose = () => (status = 'disconnected');
    ws.onerror = () => ws?.close();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      if (msg.t === 'hello') {
        file = msg.file;
        clientId = msg.clientId;
        recents = msg.recents;
        home = msg.home;
      } else if (msg.t === 'switched') {
        recents = msg.recents;
        if (msg.ok) {
          // A fresh `graph` + node snapshot follow; clear the old flow's view
          // so it doesn't linger between switch and repaint.
          switchError = undefined;
          file = msg.file;
          yaml = undefined;
          nodeStates = {};
        } else {
          switchError = msg.error ?? 'switch failed';
          clearTimeout(switchErrorTimer);
          switchErrorTimer = setTimeout(() => (switchError = undefined), 6000);
        }
      } else if (msg.t === 'graph') yaml = msg.yaml;
      else if (msg.t === 'node')
        nodeStates = { ...nodeStates, [msg.id]: msg.state };
      else if (msg.t === 'presence')
        // Strip our own entry — `peers` is strictly *other* clients.
        peers = msg.clients.filter(c => c.id !== clientId);
    };
  }

  const send = (msg: import('./protocol').ClientMessage) =>
    ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  return {
    get status() {
      return status;
    },
    get url() {
      return url;
    },
    set url(v: string) {
      url = v;
    },
    /** http(s) origin of the same host/port — the hook delivery seam. */
    get httpBase() {
      return url.replace(/^ws/, 'http').replace(/\/+$/, '');
    },
    get file() {
      return file;
    },
    /** Recently served flows (absolute paths, most-recent first, existing-only)
     *  — the path-switch dropdown's list, supplied by the core. */
    get recents() {
      return recents;
    },
    /** Last `switchFile` failure message; transient (auto-clears). */
    get switchError() {
      return switchError;
    },
    /** The core's home dir — for abbreviating displayed paths to `~/…`. */
    get home() {
      return home;
    },
    get yaml() {
      return yaml;
    },
    get nodeStates() {
      return nodeStates;
    },
    /** This connection's core-assigned presence id (from `hello`). */
    get clientId() {
      return clientId;
    },
    /** Every *other* connected client's last-announced presence. */
    get peers() {
      return peers;
    },
    connect,
    /** Re-read the flow from disk. Selective by default; `reset:true` is the
     *  toolbar ↻'s deliberate full reset (store cleared, persisted nodes
     *  re-light from disk cache). */
    reload: (reset = false) => send({ t: 'reload', reset }),
    /** Re-point the core at a different flow file. On success the core
     *  broadcasts `switched` + a fresh graph/snapshot; on failure it replies
     *  `switched{ok:false}` (surfaced via `switchError`). */
    switchFile: (path: string) => send({ t: 'switchFile', path }),
    process: (node: string, opts: { rerunStale?: boolean } = {}) =>
      send({ t: 'process', node, rerunStale: opts.rerunStale === true }),
    cancel: (node: string) => send({ t: 'cancel', node }),
    invalidate: (node: string) => send({ t: 'invalidate', node }),
    setPersist: (node: string, value: boolean) =>
      send({ t: 'setPersist', node, value }),
    setControl: (node: string, key: string, value: unknown) =>
      send({ t: 'setControl', node, key, value }),
    controlEvent: (node: string, event: string, payload?: unknown) =>
      send({ t: 'controlEvent', node, event, payload }),
    /** Forward a control-hook diagnostic (an uncaught `mount`/`update`/
     *  `destroy` throw) to the core, which folds it into the node's log
     *  buffer. Fire-and-forget — the agent's window onto a browser break. */
    controlLog: (
      node: string,
      level: 'error' | 'warn' | 'log',
      text: string
    ) => send({ t: 'controlLog', node, level, text }),
    /**
     * Merge a patch into our presence and debounce-announce it. Lossy by
     * design — a coalesced frame just means peers keep our previous state
     * a beat longer. `immediate` flushes now (used for suggestion verdicts,
     * where a peer is actively waiting).
     */
    presence(patch: Partial<PresenceData>, immediate = false) {
      mine = { ...mine, ...patch };
      if (immediate) {
        clearTimeout(flushTimer);
        sendPresenceNow();
        return;
      }
      if (flushTimer === undefined)
        flushTimer = setTimeout(sendPresenceNow, 200);
    },
  };
}
