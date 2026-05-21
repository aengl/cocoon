/**
 * The editor's connection to a core. The editor is a *pure viewer*: it never
 * holds bulk data, only the file (which it loads losslessly itself) and a
 * stream of per-node state. When no core is reachable it stays usable as an
 * offline graph preview and surfaces a connect/launch panel.
 *
 * It is also a *presence* client: it announces an opaque blob of its own
 * ephemeral UI state (label / viewport / open controls / unsaved control
 * drafts / suggestion verdicts) and observes peers' — the human↔AI
 * collaboration channel. Presence is entirely orthogonal: the core relays it
 * and interprets nothing, nothing in processing depends on it.
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

export function createCore(defaultUrl = 'ws://localhost:4000') {
  let status = $state<ConnStatus>('disconnected');
  let url = $state(defaultUrl);
  let file = $state<string | undefined>();
  let yaml = $state<string | undefined>();
  let nodeStates = $state<Record<string, NodeState>>({});
  let clientId = $state<string | undefined>();
  let peers = $state<PresenceEntry[]>([]);
  let ws: WebSocket | undefined;

  // The editor's own presence, accumulated and debounce-sent. Held outside
  // $state — it's outbound, not rendered; only `peers` (inbound) is reactive.
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
      // Re-announce whatever we already know about ourselves (label, etc.)
      // so a reconnect doesn't go dark to peers.
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
        // Drop our own entry — `peers` is strictly *other* clients.
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
    /**
     * Same host/port as the WS, http(s) scheme — the control-render-code
     * delivery origin (`GET /hook/<type>`; keystone 2/5). Derived, not a
     * separate config: the hook server is bolted onto the same core.
     */
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
    /**
     * Ask the core to re-read the flow from disk. Selective by default
     * (keystone-6, like the file watcher); `reset:true` is the toolbar ↻'s
     * deliberate full reset — store cleared, all nodes idle, persisted nodes
     * re-light from disk cache.
     */
    reload: (reset = false) => send({ t: 'reload', reset }),
    process: (node: string) => send({ t: 'process', node }),
    invalidate: (node: string) => send({ t: 'invalidate', node }),
    setPersist: (node: string, value: boolean) =>
      send({ t: 'setPersist', node, value }),
    /** Set a steering control's value (session override; node → stale). */
    setControl: (node: string, key: string, value: unknown) =>
      send({ t: 'setControl', node, key, value }),
    /** Free-form control event (LiveView model); HTML streams back in state. */
    controlEvent: (node: string, event: string, payload?: unknown) =>
      send({ t: 'controlEvent', node, event, payload }),
    /**
     * Merge a patch into our presence and debounce-announce it. Optional and
     * lossy by design — a coalesced/dropped frame just means peers keep our
     * previous state a beat longer. `immediate` flushes now (used for
     * suggestion verdicts, where a peer/agent is actively waiting).
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
