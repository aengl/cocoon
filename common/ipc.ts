import _ from 'lodash';
import serializeError from 'serialize-error';
import WebSocket from 'ws';
import { createGraphFromNodes, Graph, GraphNode } from './graph';
import { GridPosition } from './math';

// Don't import from './debug' since logs from the common debug modular are
// transported via IPC, which would cause endless loops
const debug = require('debug')('common:ipc');

interface IPCData {
  action?: 'register' | 'unregister';
  channel: string;
  payload: any;
}

export type Callback<Args = any, Response = any> = (
  args: Args
) => Response | Promise<Response>;

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
  sockets: { [name: string]: WebSocket[] | undefined } = {};
  callbacks: { [name: string]: Callback[] | undefined } = {};

  constructor(port: number) {
    this.server = new WebSocket.Server({ port });
    debug(`created IPC server on "${processName}"`);
    this.server.on('connection', socket => {
      debug(`socket connected on "${processName}"`);
      socket.on('message', (data: string) => {
        const { action, channel, payload } = JSON.parse(data) as IPCData;
        if (action === 'register') {
          this.registerSocket(channel, socket);
        } else if (action === 'unregister') {
          this.unregisterSocket(channel, socket);
        } else {
          // debug(`got message on channel "${channel}"`, payload);
          if (this.callbacks[channel] !== undefined) {
            this.callbacks[channel]!.forEach(async c => {
              const response = await c(payload);
              // If the callback returned something, send it back as an
              // immediate reply
              if (response !== undefined) {
                const encodedData = JSON.stringify({
                  channel,
                  payload: response,
                });
                socket.send(encodedData);
              }
            });
          }
        }
      });
      socket.on('close', () => {
        debug(`socket closed on "${processName}"`);
        Object.keys(this.sockets).forEach(channel =>
          this.unregisterSocket(channel, socket)
        );
      });
    });
  }

  emit(channel: string, payload: any) {
    const promise = new Promise(resolve => {
      // debug(`emitting event on channel "${channel}"`, payload);
      const data: IPCData = {
        channel,
        payload,
      };
      const encodedData = JSON.stringify(data);
      if (this.sockets[channel] !== undefined) {
        this.sockets[channel]!.filter(
          socket => socket.readyState === WebSocket.OPEN
        ).forEach(socket => {
          socket.send(encodedData);
        });
      }
      resolve();
    });
  }

  registerCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel]!.push(callback);
    return callback;
  }

  unregisterCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel] !== undefined) {
      this.callbacks[channel] = this.callbacks[channel]!.filter(
        c => c !== callback
      );
    }
  }

  registerSocket(channel: string, socket: WebSocket) {
    let sockets = this.sockets[channel];
    if (sockets === undefined) {
      sockets = [];
    }
    // Only allow a socket to be registered once per channel
    if (!sockets.some(s => s === socket)) {
      sockets.push(socket);
    }
    this.sockets[channel] = sockets;
  }

  unregisterSocket(channel: string, socket: WebSocket) {
    if (this.sockets[channel] !== undefined) {
      this.sockets[channel] = this.sockets[channel]!.filter(s => s !== socket);
    }
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * IPC Client
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export class IPCClient {
  callbacks: { [name: string]: Callback[] } = {};
  socketCore: WebSocket = new WebSocket(`ws://localhost:${portCore}/`);
  socketMain: WebSocket = new WebSocket(`ws://localhost:${portMain}/`);
  immediateCallbacks: { [channel: string]: Callback[] } = {};

  constructor() {
    this.initSocket(this.socketCore);
    this.initSocket(this.socketMain);
  }

  sendCore(channel: string, payload?: any, callback?: Callback) {
    this.socketSend(this.socketCore, { channel, payload });
    if (callback !== undefined) {
      this.registerImmediateCallback(channel, callback);
    }
  }

  sendMain(channel: string, payload?: any, callback?: Callback) {
    this.socketSend(this.socketMain, { channel, payload });
    if (callback !== undefined) {
      this.registerImmediateCallback(channel, callback);
    }
  }

  registerCallbackCore(channel: string, callback: Callback) {
    return this.registerCallback(channel, callback, this.socketCore);
  }

  registerCallbackMain(channel: string, callback: Callback) {
    return this.registerCallback(channel, callback, this.socketMain);
  }

  unregisterCallbackCore(channel: string, callback: Callback) {
    this.unregisterCallback(channel, callback, this.socketCore);
  }

  unregisterCallbackMain(channel: string, callback: Callback) {
    this.unregisterCallback(channel, callback, this.socketMain);
  }

  private registerCallback(
    channel: string,
    callback: Callback,
    socket: WebSocket
  ) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel].push(callback);
    this.socketSend(socket, {
      action: 'register',
      channel,
      payload: null,
    });
    return callback;
  }

  private unregisterCallback(
    channel: string,
    callback: Callback,
    socket: WebSocket
  ) {
    if (this.callbacks[channel] !== undefined) {
      this.callbacks[channel] = this.callbacks[channel].filter(
        c => c !== callback
      );
      this.socketSend(socket, {
        action: 'unregister',
        channel,
        payload: null,
      });
    }
  }

  private registerImmediateCallback(channel: string, callback: Callback) {
    if (this.immediateCallbacks[channel] === undefined) {
      this.immediateCallbacks[channel] = [];
    }
    this.immediateCallbacks[channel].push(callback);
    return callback;
  }

  private unregisterImmediateCallback(channel: string, callback: Callback) {
    if (this.immediateCallbacks[channel] !== undefined) {
      this.immediateCallbacks[channel] = this.immediateCallbacks[
        channel
      ].filter(c => c !== callback);
    }
  }

  private initSocket(socket: WebSocket): Promise<WebSocket> {
    socket.addEventListener('message', message => {
      return new Promise(resolve => {
        const { channel, payload } = JSON.parse(message.data) as IPCData;
        // console.info(`got message on channel ${channel}`, payload);
        // Answer listeners waiting for an immediate reply once
        const immediateCallbacks = this.immediateCallbacks[channel];
        if (immediateCallbacks !== undefined) {
          immediateCallbacks.forEach(callback => {
            callback(payload);
            this.unregisterImmediateCallback(channel, callback);
          });
        }
        // Call registered callbacks
        const callbacks = this.callbacks[channel];
        if (callbacks !== undefined) {
          callbacks.forEach(callback => callback(payload));
        }
        // Make sure we didn't deserialise this message for no reason
        if (immediateCallbacks === undefined && callbacks === undefined) {
          throw new Error(`message on channel "${channel}" had no subscriber`);
        }
        resolve();
      });
    });
    return new Promise(resolve => {
      socket.addEventListener('open', () => {
        debug(`IPC client connected to "${socket.url}"`);
        resolve(socket);
      });
    });
  }

  private async socketSend(socket: WebSocket, data: IPCData) {
    while (socket!.readyState === WebSocket.CONNECTING) {
      // Wait until the client connects
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return new Promise(resolve => {
      socket!.send(JSON.stringify(data));
      resolve();
    });
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Server and Client Instances
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const serverCore = isCoreProcess ? new IPCServer(portCore) : null;
const serverMain = isMainProcess ? new IPCServer(portMain) : null;
const allServers = serverCore || serverMain;
const clientEditor = isEditorProcess ? new IPCClient() : null;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Serialisation
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function serialiseNode(node: GraphNode) {
  if (isCoreProcess) {
    return {
      definition: node.definition,
      description: node.description,
      id: node.id,
      in: node.in,
      state: {
        error:
          node.state.error === null ? null : serializeError(node.state.error),
        hot: node.state.hot,
        portInfo: node.state.portInfo,
        status: node.state.status,
        summary: node.state.summary,
        view: node.state.view,
        viewData: node.state.viewData,
        viewState: node.state.viewState,
      },
      type: node.type,
    };
  }
  return {
    definition: node.definition,
    id: node.id,
    state: {
      hot: node.state.hot,
      view: node.state.view,
      viewState: node.state.viewState,
    },
  };
}
export function getUpdatedNode(node: GraphNode, serialisedNode: object) {
  return _.assign({}, node, deserialiseNode(serialisedNode));
}
export function updatedNode(node: GraphNode, serialisedNode: object) {
  return _.assign(node, deserialiseNode(serialisedNode));
}
export function deserialiseNode(serialisedNode: object) {
  const node = serialisedNode as GraphNode;
  // Edges don't get serialised, but their attributes need initialisation
  node.edgesIn = [];
  node.edgesOut = [];
  return node;
}

export function serialiseGraph(graph: Graph) {
  return graph.nodes.map(node => serialiseNode(node));
}
export function deserialiseGraph(serialisedGraph: object[]) {
  const nodes = serialisedGraph.map(node => deserialiseNode(node));
  return createGraphFromNodes(nodes);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Definitions
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface OpenDefinitionsArgs {
  definitionsPath: string;
}
export function onOpenDefinitions(callback: Callback<OpenDefinitionsArgs>) {
  return serverCore!.registerCallback('open-definitions', callback);
}
export function sendOpenDefinitions(args: OpenDefinitionsArgs) {
  clientEditor!.sendCore('open-definitions', args);
}
export function onUpdateDefinitions(callback: Callback) {
  return serverCore!.registerCallback('update-definitions', callback);
}
export function sendUpdateDefinitions() {
  clientEditor!.sendCore('update-definitions');
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Editor
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface PortDataRequestArgs {
  nodeId: string;
  port: string;
}
export interface PortDataResponseArgs {
  data?: any;
}
export function onPortDataRequest(
  callback: Callback<PortDataRequestArgs, PortDataResponseArgs>
) {
  return serverCore!.registerCallback('port-data-request', callback);
}
export function sendPortDataRequest(
  args: PortDataRequestArgs,
  callback: Callback<PortDataResponseArgs>
) {
  clientEditor!.sendCore('port-data-request', args, callback);
}

export interface GraphSyncArgs {
  definitionsPath: string;
  serialisedGraph: object[];
}
export function onGraphSync(callback: Callback<GraphSyncArgs>) {
  serverCore!.registerCallback('graph-sync', callback);
}
export function sendGraphSync(args: GraphSyncArgs) {
  if (isCoreProcess) {
    serverCore!.emit('graph-sync', args);
  } else {
    clientEditor!.sendCore('graph-sync');
  }
}
export function registerGraphSync(callback: Callback<GraphSyncArgs>) {
  return clientEditor!.registerCallbackCore(`graph-sync`, callback);
}
export function unregisterGraphSync(callback: Callback<GraphSyncArgs>) {
  clientEditor!.unregisterCallbackCore(`graph-sync`, callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Data View Window
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface OpenDataViewWindowArgs {
  nodeId: string;
}
export function onOpenDataViewWindow(
  callback: Callback<OpenDataViewWindowArgs>
) {
  return serverMain!.registerCallback('open-data-view-window', callback);
}
export function sendOpenDataViewWindow(args: OpenDataViewWindowArgs) {
  clientEditor!.sendMain('open-data-view-window', args);
}

export interface NodeViewStateChangedArgs {
  nodeId: string;
  state: any;
}
export function onNodeViewStateChanged(
  callback: Callback<NodeViewStateChangedArgs>
) {
  return serverCore!.registerCallback('node-view-state-changed', callback);
}
export function sendNodeViewStateChanged(args: NodeViewStateChangedArgs) {
  clientEditor!.sendCore('node-view-state-changed', args);
}

export interface NodeViewQueryArgs {
  nodeId: string;
  query: any;
}
export interface NodeViewQueryResponseArgs {
  data?: any;
}
export function onNodeViewQuery(
  callback: Callback<NodeViewQueryArgs, NodeViewQueryResponseArgs>
) {
  return serverCore!.registerCallback(`node-view-query`, callback);
}
export function sendNodeViewQuery(
  args: NodeViewQueryArgs,
  callback: Callback<NodeViewQueryResponseArgs>
) {
  clientEditor!.sendCore('node-view-query', args, callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface EvaluateNodeArgs {
  nodeId: string;
}
export function onEvaluateNode(callback: Callback<EvaluateNodeArgs>) {
  serverCore!.registerCallback('evaluate-node', callback);
}
export function sendEvaluateNode(args: EvaluateNodeArgs) {
  clientEditor!.sendCore('evaluate-node', args);
}

export interface NodeSyncArgs {
  serialisedNode: object;
}
export function onNodeSync(callback: Callback<NodeSyncArgs>) {
  serverCore!.registerCallback('node-sync', callback);
}
export function sendNodeSync(args: NodeSyncArgs) {
  if (isCoreProcess) {
    serverCore!.emit(`node-sync/${_.get(args.serialisedNode, 'id')}`, args);
  } else {
    clientEditor!.sendCore('node-sync', args);
  }
}
export function registerNodeSync(
  nodeId: string,
  callback: Callback<NodeSyncArgs>
) {
  return clientEditor!.registerCallbackCore(`node-sync/${nodeId}`, callback);
}
export function unregisterNodeSync(
  nodeId: string,
  callback: Callback<NodeSyncArgs>
) {
  clientEditor!.unregisterCallbackCore(`node-sync/${nodeId}`, callback);
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
  return clientEditor!.registerCallbackCore(
    `node-progress/${nodeId}`,
    callback
  );
}
export function unregisterNodeProgress(
  nodeId: string,
  callback: Callback<NodeProgressArgs>
) {
  clientEditor!.unregisterCallbackCore(`node-sync/${nodeId}`, callback);
}

export interface CreateNodeArgs {
  type: string;
  gridPosition?: GridPosition;
  edge?: {
    fromNodeId?: string;
    fromNodePort: string;
    toNodeId?: string;
    toNodePort: string;
  };
}
export function onCreateNode(callback: Callback<CreateNodeArgs>) {
  serverCore!.registerCallback('create-node', callback);
}
export function sendCreateNode(args: CreateNodeArgs) {
  clientEditor!.sendCore('create-node', args);
}

export interface RemoveNodeArgs {
  nodeId: string;
}
export function onRemoveNode(callback: Callback<RemoveNodeArgs>) {
  serverCore!.registerCallback('remove-node', callback);
}
export function sendRemoveNode(args: RemoveNodeArgs) {
  clientEditor!.sendCore('remove-node', args);
}

export interface CreateEdgeArgs {
  fromNodeId: string;
  fromNodePort: string;
  toNodeId: string;
  toNodePort: string;
}
export function onCreateEdge(callback: Callback<CreateEdgeArgs>) {
  serverCore!.registerCallback('create-edge', callback);
}
export function sendCreateEdge(args: CreateEdgeArgs) {
  clientEditor!.sendCore('create-edge', args);
}

export interface RemoveEdgeArgs {
  nodeId: string;
  port: string;
}
export function onRemoveEdge(callback: Callback<RemoveEdgeArgs>) {
  serverCore!.registerCallback('remove-edge', callback);
}
export function sendRemoveEdge(args: RemoveEdgeArgs) {
  clientEditor!.sendCore('remove-edge', args);
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
  return clientEditor!.registerCallbackCore('error', callback);
}
export function unregisterError(callback: Callback<ErrorArgs>) {
  clientEditor!.unregisterCallbackCore('error', callback);
}

export interface LogArgs {
  namespace: string;
  args: any[];
}
export function sendLog(args: LogArgs) {
  allServers!.emit('log', args);
}
export function registerLog(callback: Callback<LogArgs>) {
  return clientEditor!.registerCallbackCore('log', callback);
}
export function unregisterLog(callback: Callback<LogArgs>) {
  clientEditor!.unregisterCallbackCore('log', callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Memory
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface MemoryUsageResponseArgs {
  process: 'main' | 'core';
  memoryUsage: NodeJS.MemoryUsage;
}
export function onMemoryUsageRequest(
  callback: Callback<undefined, MemoryUsageResponseArgs>
) {
  return allServers!.registerCallback('memory-usage-request', callback);
}
export function sendMemoryUsageRequest(
  callback: Callback<MemoryUsageResponseArgs>
) {
  clientEditor!.sendCore('memory-usage-request', undefined, callback);
  clientEditor!.sendMain('memory-usage-request', undefined, callback);
}
