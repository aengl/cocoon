/**
 * The editor's connection to a core. The editor is a *pure viewer*: it never
 * holds bulk data, only the file (which it loads losslessly itself) and a
 * stream of per-node state. When no core is reachable it stays usable as an
 * offline graph preview and surfaces a connect/launch panel.
 *
 * `.svelte.ts` so the connection state is reactive across the app.
 */
import type { NodeState, ServerMessage } from './protocol';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export function createCore(defaultUrl = 'ws://localhost:4000') {
  let status = $state<ConnStatus>('disconnected');
  let url = $state(defaultUrl);
  let file = $state<string | undefined>();
  let yaml = $state<string | undefined>();
  let nodeStates = $state<Record<string, NodeState>>({});
  let ws: WebSocket | undefined;

  function connect(next = url) {
    url = next;
    ws?.close();
    status = 'connecting';
    nodeStates = {};
    yaml = undefined;
    file = undefined;
    try {
      ws = new WebSocket(url);
    } catch {
      status = 'disconnected';
      return;
    }
    ws.onopen = () => (status = 'connected');
    ws.onclose = () => (status = 'disconnected');
    ws.onerror = () => ws?.close();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      if (msg.t === 'hello') file = msg.file;
      else if (msg.t === 'graph') yaml = msg.yaml;
      else if (msg.t === 'node')
        nodeStates = { ...nodeStates, [msg.id]: msg.state };
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
    get file() {
      return file;
    },
    get yaml() {
      return yaml;
    },
    get nodeStates() {
      return nodeStates;
    },
    connect,
    /** Ask the core to re-read the flow from disk (full reset). */
    reload: () => send({ t: 'reload' }),
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
  };
}
