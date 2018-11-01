import _ from 'lodash';
import WebSocket from 'ws';
import { CocoonNode, NodeStatus } from './node';

// Don't import from './debug' since logs from the common debug modular are
// transported via IPC, which would cause endless loops
const debug = require('debug')('common:ipc');

interface IPCData {
  channel: string;
  action: 'register' | 'unregister' | 'send';
  payload?: any;
}

export type Callback<T = any> = (args: T) => void;

export const isMainProcess = process.argv[0].endsWith('Electron');
export const isEditorProcess = process.argv[0].endsWith('Electron Helper');
export const isCoreProcess = !isMainProcess && !isEditorProcess;
export const processName = isMainProcess
  ? 'main'
  : isEditorProcess
    ? 'editor'
    : 'core';

const portCore = 22448;
const portMain = 22449;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * IPC Server
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export class IPCServer {
  server: WebSocket.Server;
  sockets: { [name: string]: WebSocket[] } = {};
  callbacks: { [name: string]: Callback[] } = {};

  constructor(port: number) {
    this.server = new WebSocket.Server({ port });
    debug(`created IPC server on "${processName}"`);
    this.server.on('connection', socket => {
      socket.on('message', (data: string) => {
        const { channel, action, payload } = JSON.parse(data) as IPCData;
        // debug(`got "${action}" request on channel "${channel}"`);
        if (action === 'register') {
          this.registerSocket(channel, socket);
        } else if (action === 'unregister') {
          this.unregisterSocket(channel, socket);
        } else {
          this.emit(channel, payload);
        }
      });
    });
  }

  emit(channel: string, data: any) {
    const promise = new Promise(resolve => {
      // debug(`emitting event on channel "${channel}"`);
      // debug(data);
      if (this.callbacks[channel] !== undefined) {
        this.callbacks[channel].forEach(c => c(data));
      }
      if (this.sockets[channel] !== undefined) {
        const encodedData = JSON.stringify(data);
        this.sockets[channel].forEach(socket => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(encodedData);
          } else {
            // Remove dead sockets
            this.unregisterSocket(channel, socket);
          }
        });
      }
      resolve();
    });
    return this;
  }

  registerSocket(channel: string, socket: WebSocket) {
    if (this.sockets[channel] === undefined) {
      this.sockets[channel] = [];
    }
    this.sockets[channel].push(socket);
    return this;
  }

  unregisterSocket(channel: string, socket: WebSocket) {
    if (this.sockets[channel]) {
      this.sockets[channel] = this.sockets[channel].filter(c => c !== socket);
    }
    return this;
  }

  registerCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel].push(callback);
    return this;
  }

  unregisterCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel]) {
      this.callbacks[channel] = this.callbacks[channel].filter(
        c => c !== callback
      );
    }
    return this;
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Server instances
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const serverCore = isCoreProcess ? new IPCServer(portCore) : null;
const serverMain = isMainProcess ? new IPCServer(portMain) : null;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * IPC Client
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export class IPCClient {
  channel: string;
  callback?: Callback;
  socket?: WebSocket;

  constructor(channel: string, callback?: Callback) {
    this.channel = channel;
    this.callback = callback;
  }

  connectMain(onConnected?: (x: this) => void) {
    this.connect(
      portMain,
      'main',
      onConnected
    );
    return this;
  }

  connectCore(onConnected?: (x: this) => void) {
    this.connect(
      portCore,
      'core',
      onConnected
    );
    return this;
  }

  send(payload: any) {
    this.socketSend({ action: 'send', channel: this.channel, payload });
    return this;
  }

  register() {
    this.socketSend({ action: 'register', channel: this.channel });
    return this;
  }

  unregister() {
    this.socketSend({ action: 'unregister', channel: this.channel }).then(() =>
      this.close()
    );
    return this;
  }

  close() {
    this.socket!.close();
    return this;
  }

  private connect(port: number, path: string, onConnected?: (x: this) => void) {
    this.socket = new WebSocket(
      `ws://localhost:${port}/${path}/${this.channel}`
    );
    // debug(`created IPC client at "${this.socket.url}"`);
    this.socket.addEventListener('open', () => {
      if (this.callback) {
        this.register();
      }
      if (onConnected) {
        onConnected(this);
      }
    });
    if (this.callback) {
      this.socket.addEventListener('message', message => {
        // debug(`got a message on channel "${this.channel}"`);
        const data = JSON.parse(message.data);
        // debug(data);
        this.callback!(data);
      });
    }
  }

  private socketSend(data: IPCData) {
    return new Promise(resolve => {
      this.socket!.send(JSON.stringify(data));
      resolve();
    });
  }
}
/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Serialisation
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function serialiseNode(node: CocoonNode) {
  return {
    config: node.config,
    description: node.description,
    error: node.error,
    group: node.group,
    hot: node.hot,
    id: node.id,
    in: node.in,
    status: node.status,
    summary: node.summary,
    type: node.type,
  };
}

export function updateNode(node: CocoonNode, serialisedNode: object) {
  _.assign(node, serialisedNode);
}

export function deserialiseNode(serialisedNode: object): CocoonNode {
  return serialisedNode as CocoonNode;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Editor
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface OpenDefinitionsArgs {
  definitionsPath: string;
}

export function onOpenDefinitions(callback: Callback<OpenDefinitionsArgs>) {
  serverCore!.registerCallback('open-definitions', callback);
}

export function sendOpenDefinitions(args: OpenDefinitionsArgs) {
  new IPCClient('open-definitions').connectCore(s => {
    s.send(args);
    s.close();
  });
}

export interface EvaluateNodeArgs {
  nodeId: string;
}

export function onEvaluateNode(callback: Callback<EvaluateNodeArgs>) {
  serverCore!.registerCallback('evaluate-node', callback);
}

export function sendEvaluateNode(args: EvaluateNodeArgs) {
  new IPCClient('evaluate-node').connectCore(s => {
    s.send(args);
    s.close();
  });
}

export interface PortDataRequestArgs {
  nodeId: string;
  port: string;
}

export function onPortDataRequest(callback: Callback<PortDataRequestArgs>) {
  serverCore!.registerCallback('port-data-request', callback);
}

export function sendPortDataRequest(args: PortDataRequestArgs) {
  new IPCClient('port-data-request').connectCore(s => {
    s.send(args);
    s.close();
  });
}

export interface PortDataResponseArgs {
  request: PortDataRequestArgs;
  data: any;
}

export function sendPortDataResponse(args: PortDataResponseArgs) {
  serverCore!.emit(`port-data-response`, args);
}

export function registerPortDataResponse(
  callback: Callback<PortDataResponseArgs>
) {
  return new IPCClient(`port-data-response`, callback).connectCore();
}

export function unregisterPortDataResponse(client: IPCClient) {
  client.unregister();
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Data View Window
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface OpenDataViewWindowArgs {
  serialisedNode: object;
}

export function onOpenDataViewWindow(
  callback: Callback<OpenDataViewWindowArgs>
) {
  serverMain!.registerCallback('open-data-view-window', callback);
}

export function sendOpenDataViewWindow(args: OpenDataViewWindowArgs) {
  new IPCClient('open-data-view-window').connectMain(s => {
    s.send(args);
    s.close();
  });
}

export interface NodeViewStateChangedArgs {
  nodeId: string;
  state: any;
}

export function onNodeViewStateChanged(
  callback: Callback<NodeViewStateChangedArgs>
) {
  serverCore!.registerCallback(`node-view-state-changed`, callback);
}

export function sendNodeViewStateChanged(args: NodeViewStateChangedArgs) {
  new IPCClient(`node-view-state-changed`).connectCore(s => {
    s.send(args);
    s.close();
  });
}

export interface NodeViewQueryArgs {
  nodeId: string;
  query: any;
}

export function onNodeViewQuery(callback: Callback<NodeViewQueryArgs>) {
  serverCore!.registerCallback(`node-view-query`, callback);
}

export function sendNodeViewQuery(args: NodeViewQueryArgs) {
  new IPCClient(`node-view-query`).connectCore(s => {
    s.send(args);
    s.close();
  });
}

export interface NodeViewQueryResponseArgs {
  data: any;
}

export function sendNodeViewQueryResponse(
  nodeId: string,
  args: NodeViewQueryResponseArgs
) {
  serverCore!.emit(`node-view-query-response/${nodeId}`, args);
}

export function registerNodeViewQueryResponse(
  nodeId: string,
  callback: Callback<NodeViewQueryResponseArgs>
) {
  return new IPCClient(
    `node-view-query-response/${nodeId}`,
    callback
  ).connectCore();
}

export function unregisterNodeViewQueryResponse(client: IPCClient) {
  client.unregister();
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface NodeStatusUpdateArgs {
  status: NodeStatus;
}

export function sendNodeStatusUpdate(
  nodeId: string,
  args: NodeStatusUpdateArgs
) {
  serverCore!.emit(`node-status-update/${nodeId}`, args);
}

export function registerNodeStatusUpdate(
  nodeId: string,
  callback: Callback<NodeStatusUpdateArgs>
) {
  return new IPCClient(`node-status-update/${nodeId}`, callback).connectCore();
}

export function unregisterNodeStatusUpdate(client: IPCClient) {
  client.unregister();
}

export interface NodeEvaluatedArgs {
  summary?: string;
  viewData?: any;
}

export function sendNodeEvaluated(nodeId: string, args: NodeEvaluatedArgs) {
  serverCore!.emit(`node-evaluated/${nodeId}`, args);
}

export function registerNodeEvaluated(
  nodeId: string,
  callback: Callback<NodeEvaluatedArgs>
) {
  return new IPCClient(`node-evaluated/${nodeId}`, callback).connectCore();
}

export function unregisterNodeEvaluated(client: IPCClient) {
  client.unregister();
}

export interface NodeErrorArgs {
  error: Error;
}

export function sendNodeError(nodeId: string, args: NodeErrorArgs) {
  serverCore!.emit(`node-error/${nodeId}`, args);
}

export function registerNodeError(
  nodeId: string,
  callback: Callback<NodeErrorArgs>
) {
  return new IPCClient(`node-error/${nodeId}`, callback).connectCore();
}

export function unregisterNodeError(client: IPCClient) {
  client.unregister();
}

export interface NodeProgressArgs {
  summary?: string;
  percent?: number;
}

export function sendNodeProgress(nodeId: string, args: NodeProgressArgs) {
  serverCore!.emit(`node-progress/${nodeId}`, args);
}

export function registerNodeProgress(
  nodeId: string,
  callback: Callback<NodeProgressArgs>
) {
  return new IPCClient(`node-progress/${nodeId}`, callback).connectCore();
}

export function unregisterNodeProgress(client: IPCClient) {
  client.unregister();
}

export interface NodeSyncArgs {
  nodeId: string;
  hot?: boolean;
}

export function onNodeSync(callback: Callback<NodeSyncArgs>) {
  serverCore!.registerCallback('node-sync', callback);
}

export function sendNodeSync(args: NodeSyncArgs) {
  return new IPCClient(`node-sync`).connectCore(s => {
    s.send(args);
    s.close();
  });
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Definitions
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface GraphChangedArgs {
  definitions: string;
  definitionsPath: string;
}

export function sendGraphChanged(args: GraphChangedArgs) {
  serverCore!.emit('graph-changed', args);
}

export function registerGraphChanged(callback: Callback<GraphChangedArgs>) {
  return new IPCClient('graph-changed', callback).connectCore();
}

export function unregisterGraphChanged(client: IPCClient) {
  client.unregister();
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Errors & Logs
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface ErrorArgs {
  error: Error;
}

export function sendError(args: ErrorArgs) {
  serverCore!.emit('error', args);
}

export function registerError(callback: Callback<ErrorArgs>) {
  return new IPCClient('error', callback).connectCore();
}

export function unregisterError(client: IPCClient) {
  client.unregister();
}

export interface LogArgs {
  namespace: string;
  args: any[];
}

export function sendLog(args: LogArgs) {
  if (serverCore) {
    serverCore.emit('log', args);
  } else if (serverMain) {
    serverMain.emit('log', args);
  }
}

export function registerLog(callback: Callback<LogArgs>) {
  return new IPCClient('log', callback).connectCore();
}

export function unregisterLog(client: IPCClient) {
  client.unregister();
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Memory
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface MemoryUsageArgs {
  memoryUsage: NodeJS.MemoryUsage;
}

export function sendCoreMemoryUsage(args: MemoryUsageArgs) {
  serverCore!.emit('memory-usage', args);
}

export function registerCoreMemoryUsage(callback: Callback<MemoryUsageArgs>) {
  return new IPCClient('memory-usage', callback).connectCore();
}

export function unregisterCoreMemoryUsage(client: IPCClient) {
  client.unregister();
}

export function sendMainMemoryUsage(args: MemoryUsageArgs) {
  serverMain!.emit('memory-usage', args);
}

export function registerMainMemoryUsage(callback: Callback<MemoryUsageArgs>) {
  return new IPCClient('memory-usage', callback).connectMain();
}

export function unregisterMainMemoryUsage(client: IPCClient) {
  client.unregister();
}
