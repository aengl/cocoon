import assert from 'assert';
import _ from 'lodash';
import serializeError from 'serialize-error';
import WebSocket from 'ws';
import { CocoonNode, createGraphFromNodes, Graph } from './graph';
import { GridPosition } from './math';

// Don't import from './debug' since logs from the common debug modular are
// transported via IPC, which would cause endless loops
const debug = require('debug')('common:ipc');

interface IPCData {
  action?: 'register' | 'unregister';
  channel: string;
  payload: any;
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
  sockets: { [name: string]: WebSocket[] | undefined } = {};
  callbacks: { [name: string]: Callback[] | undefined } = {};

  constructor(port: number) {
    this.server = new WebSocket.Server({ port });
    debug(`created IPC server on "${processName}"`);
    this.server.on('connection', socket => {
      debug(`socket connected`);
      socket.on('message', (data: string) => {
        const { action, channel, payload } = JSON.parse(data) as IPCData;
        if (action === 'register') {
          this.registerSocket(channel, socket);
        } else if (action === 'unregister') {
          this.unregisterSocket(channel, socket);
        } else {
          // debug(`got message on channel "${channel}"`, payload);
          if (this.callbacks[channel] !== undefined) {
            this.callbacks[channel]!.forEach(c => c(payload));
          }
        }
      });
      socket.on('close', () => {
        debug(`socket closed`);
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

  constructor() {
    this.initSocket(this.socketCore);
    this.initSocket(this.socketMain);
  }

  sendCore(channel: string, payload?: any) {
    this.socketSend(this.socketCore, { channel, payload });
  }

  sendMain(channel: string, payload?: any) {
    this.socketSend(this.socketMain, { channel, payload });
  }

  registerCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel].push(callback);
    this.socketSend(this.socketCore, {
      action: 'register',
      channel,
      payload: null,
    });
    return callback;
  }

  unregisterCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel] !== undefined) {
      this.callbacks[channel] = this.callbacks[channel].filter(
        c => c !== callback
      );
      this.socketSend(this.socketCore, {
        action: 'unregister',
        channel,
        payload: null,
      });
    }
  }

  private initSocket(socket: WebSocket): Promise<WebSocket> {
    socket.addEventListener('message', message => {
      // debug(`got a message`);
      // debug(message);
      return new Promise(resolve => {
        const { channel, payload } = JSON.parse(message.data) as IPCData;
        assert(channel !== null);
        if (this.callbacks[channel!] !== undefined) {
          this.callbacks[channel!].forEach(c => c(payload));
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
const clientEditor = isEditorProcess ? new IPCClient() : null;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Serialisation
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function serialiseNode(node: CocoonNode) {
  if (isCoreProcess) {
    return {
      config: node.config,
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
      viewState: node.state.viewState,
    },
  };
}
export function getUpdatedNode(node: CocoonNode, serialisedNode: object) {
  return _.assign({}, node, deserialiseNode(serialisedNode));
}
export function updatedNode(node: CocoonNode, serialisedNode: object) {
  return _.assign(node, deserialiseNode(serialisedNode));
}
export function deserialiseNode(serialisedNode: object) {
  return serialisedNode as CocoonNode;
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
export function onPortDataRequest(callback: Callback<PortDataRequestArgs>) {
  return serverCore!.registerCallback('port-data-request', callback);
}
export function sendPortDataRequest(args: PortDataRequestArgs) {
  clientEditor!.sendCore('port-data-request', args);
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
  return clientEditor!.registerCallback('port-data-response', callback);
}
export function unregisterPortDataResponse(
  callback: Callback<PortDataResponseArgs>
) {
  clientEditor!.unregisterCallback('port-data-response', callback);
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
  return clientEditor!.registerCallback(`graph-sync`, callback);
}
export function unregisterGraphSync(callback: Callback<GraphSyncArgs>) {
  clientEditor!.unregisterCallback(`graph-sync`, callback);
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
export function onNodeViewQuery(callback: Callback<NodeViewQueryArgs>) {
  return serverCore!.registerCallback(`node-view-query`, callback);
}
export function sendNodeViewQuery(args: NodeViewQueryArgs) {
  clientEditor!.sendCore('node-view-query', args);
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
  return clientEditor!.registerCallback(
    `node-view-query-response/${nodeId}`,
    callback
  );
}
export function unregisterNodeViewQueryResponse(
  nodeId: string,
  callback: Callback<NodeViewQueryResponseArgs>
) {
  clientEditor!.unregisterCallback(
    `node-view-query-response/${nodeId}`,
    callback
  );
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
  return clientEditor!.registerCallback(`node-sync/${nodeId}`, callback);
}
export function unregisterNodeSync(
  nodeId: string,
  callback: Callback<NodeSyncArgs>
) {
  clientEditor!.unregisterCallback(`node-sync/${nodeId}`, callback);
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
  return clientEditor!.registerCallback(`node-progress/${nodeId}`, callback);
}
export function unregisterNodeProgress(
  nodeId: string,
  callback: Callback<NodeProgressArgs>
) {
  clientEditor!.unregisterCallback(`node-sync/${nodeId}`, callback);
}

export interface CreateNodeArgs {
  type: string;
  gridPosition?: GridPosition;
  connectedNodeId: string;
  connectedNodePort: string;
  connectedPort: string;
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
  return clientEditor!.registerCallback('error', callback);
}
export function unregisterError(callback: Callback<ErrorArgs>) {
  clientEditor!.unregisterCallback('error', callback);
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
  return clientEditor!.registerCallback('log', callback);
}
export function unregisterLog(callback: Callback<LogArgs>) {
  clientEditor!.unregisterCallback('log', callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Memory
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface MemoryUsageArgs {
  memoryUsage: NodeJS.MemoryUsage;
}
export function sendMemoryUsage(args: MemoryUsageArgs) {
  if (serverCore) {
    serverCore.emit('memory-usage-core', args);
  } else if (serverMain) {
    serverMain!.emit('memory-usage-main', args);
  }
}
export function registerCoreMemoryUsage(callback: Callback<MemoryUsageArgs>) {
  return clientEditor!.registerCallback('memory-usage-core', callback);
}
export function unregisterCoreMemoryUsage(callback: Callback<MemoryUsageArgs>) {
  clientEditor!.unregisterCallback('memory-usage-core', callback);
}
export function registerMainMemoryUsage(callback: Callback<MemoryUsageArgs>) {
  return clientEditor!.registerCallback('memory-usage-main', callback);
}
export function unregisterMainMemoryUsage(callback: Callback<MemoryUsageArgs>) {
  clientEditor!.unregisterCallback('memory-usage-main', callback);
}
