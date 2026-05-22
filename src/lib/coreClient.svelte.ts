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
    process: (node: string, opts: { rerunStale?: boolean } = {}) =>
      send({ t: 'process', node, rerunStale: opts.rerunStale === true }),
    invalidate: (node: string) => send({ t: 'invalidate', node }),
    setPersist: (node: string, value: boolean) =>
      send({ t: 'setPersist', node, value }),
    setControl: (node: string, key: string, value: unknown) =>
      send({ t: 'setControl', node, key, value }),
    controlEvent: (node: string, event: string, payload?: unknown) =>
      send({ t: 'controlEvent', node, event, payload }),
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
