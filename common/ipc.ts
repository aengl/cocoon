import _ from 'lodash';
import serializeError, { ErrorObject } from 'serialize-error';
import WebSocketAsPromised from 'websocket-as-promised';
import WebSocket from 'ws';
import { createGraphFromNodes, Graph, GraphNode, PortInfo } from './graph';
import { GridPosition } from './math';
import { CocoonNode } from './node';
import { CocoonRegistry } from './registry';

const Debug = require('debug');
const debug = require('debug')('common:ipc');

interface IPCData<T = any> {
  id?: number;
  action?: 'register' | 'unregister';
  channel: string;
  payload: T;
}

export type Callback<Args = any, Response = any> = (
  args: Args
) => Response | Promise<Response>;

// Determine what process this module is used by. Depending on the process, the
// IPC module works differently.
export const isCoreProcess = Boolean(
  process.argv[1] && process.argv[1].match('/core/')
);
export const isMainProcess = Boolean(
  process.argv[1] && process.argv[1].match('/editor/')
);
export const isEditorProcess = process.argv[0] === undefined;
export const isTestProcess = Boolean(
  process.argv[1] && process.argv[1].match('/ava/')
);
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
  server: WebSocket.Server | null = null;
  sockets: { [name: string]: WebSocket[] | undefined } = {};
  callbacks: { [name: string]: Callback[] | undefined } = {};

  start(port: number) {
    return new Promise(resolve => {
      this.server = new WebSocket.Server({ port });
      debug(`created IPC server on "${processName}"`);
      this.server.on('connection', socket => {
        debug(`socket connected on "${processName}"`);
        socket.on('message', (data: string) => {
          const { action, channel, id, payload } = JSON.parse(data) as IPCData;
          if (action === 'register') {
            this.registerSocket(channel, socket);
          } else if (action === 'unregister') {
            this.unregisterSocket(channel, socket);
          } else {
            // debug(`got message on channel "${channel}"`, payload);
            if (this.callbacks[channel] !== undefined) {
              this.callbacks[channel]!.forEach(async callback => {
                const response = await callback(payload);
                // If the callback returned something, send it back as an
                // immediate reply
                if (response !== undefined) {
                  const encodedData = JSON.stringify({
                    channel,
                    id,
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
      this.server.on('listening', () => resolve());
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

let reconnectCallback: (() => void) | null = null;
export function onClientReconnect(callback: () => void) {
  reconnectCallback = callback;
}

let disconnectCallback: (() => void) | null = null;
export function onClientDisconnect(callback: () => void) {
  disconnectCallback = callback;
}

export class IPCClient {
  callbacks: { [name: string]: Callback[] } = {};
  reconnectTimeout?: number;
  socketCore: WebSocketAsPromised | null = null;
  socketMain: WebSocketAsPromised = this.createSocket(
    `ws://127.0.0.1:${portMain}/`
  );

  async connect() {
    // Connect to the main process first to query it for the core address
    await this.socketMain.open();
    const response = await sendRequestCoreURI();
    // Connect to the core process
    this.socketCore = this.createSocket(
      response.uri || `ws://127.0.0.1:${portCore}/`
    );
    await this.socketCore.open();
  }

  sendCore(channel: string, payload?: any) {
    this.socketCore!.sendPacked({ channel, payload });
  }

  sendMain(channel: string, payload?: any) {
    this.socketMain.sendPacked({ channel, payload });
  }

  invoke(channel: string, payload?: any) {
    const callbacks = this.callbacks[channel];
    if (callbacks !== undefined) {
      callbacks.forEach(callback => callback(payload));
    }
    return callbacks;
  }

  async requestCore<ResponseArgs = any>(
    channel: string,
    payload?: any,
    callback?: Callback<ResponseArgs>
  ) {
    const result: IPCData<ResponseArgs> = await this.socketCore!.sendRequest({
      channel,
      payload,
    });
    if (callback) {
      callback(result.payload);
    }
    return result.payload;
  }

  async requestMain<ResponseArgs = any>(
    channel: string,
    payload?: any,
    callback?: Callback<ResponseArgs>
  ) {
    const result: IPCData<ResponseArgs> = await this.socketMain.sendRequest({
      channel,
      payload,
    });
    if (callback) {
      callback(result.payload);
    }
    return result.payload as ResponseArgs;
  }

  registerCallbackCore(channel: string, callback: Callback) {
    return this.registerCallback(channel, callback, this.socketCore!);
  }

  registerCallbackMain(channel: string, callback: Callback) {
    return this.registerCallback(channel, callback, this.socketMain!);
  }

  unregisterCallbackCore(channel: string, callback: Callback) {
    this.unregisterCallback(channel, callback, this.socketCore!);
  }

  unregisterCallbackMain(channel: string, callback: Callback) {
    this.unregisterCallback(channel, callback, this.socketMain!);
  }

  private registerCallback(
    channel: string,
    callback: Callback,
    socket: WebSocketAsPromised
  ) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel].push(callback);
    socket.sendPacked({
      action: 'register',
      channel,
      payload: null,
    });
    return callback;
  }

  private unregisterCallback(
    channel: string,
    callback: Callback,
    socket: WebSocketAsPromised
  ) {
    if (this.callbacks[channel] !== undefined) {
      this.callbacks[channel] = this.callbacks[channel].filter(
        c => c !== callback
      );
      socket.sendPacked({
        action: 'unregister',
        channel,
        payload: null,
      });
    }
  }

  private createSocket(url: string) {
    const socket = new WebSocketAsPromised(url, {
      attachRequestId: (data, id) => ({ id, ...data }),
      extractRequestId: data => data && data.id,
      packMessage: data => JSON.stringify(data),
      unpackMessage: message => JSON.parse(message.toString()),
    });
    socket.onUnpackedMessage.addListener(message => {
      const { channel, id, payload } = message as IPCData;
      // console.info(`got message on channel ${channel}`, payload);
      // Call registered callbacks
      const callbacks = this.invoke(channel, payload);
      // Make sure we didn't deserialise this message for no reason
      if (id === undefined && callbacks === undefined) {
        throw new Error(`message on channel "${channel}" had no subscriber`);
      }
    });
    socket.onClose.addListener(() => {
      if (disconnectCallback) {
        disconnectCallback();
      }
      this.reconnect(socket);
    });
    return socket;
  }

  private async reconnect(socket: WebSocketAsPromised) {
    if (!this.reconnectTimeout) {
      try {
        await socket.open();
        if (reconnectCallback && socket === this.socketCore) {
          // TODO: Ideally we only fire the reconnect callback once all sockets
          // are connected, but for some reason I couldn't get that to work.
          // Thus we only fire for the "core" socket, since it's generally the
          // much slower one.
          reconnectCallback();
        }
      } catch {
        this.reconnectTimeout = setTimeout(() => {
          delete this.reconnectTimeout;
          this.reconnect(socket);
        }, 500);
      }
    }
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Server and Client Instances & Initialisation
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

let serverCore: IPCServer | null = null;
let serverMain: IPCServer | null = null;
let allServers: IPCServer | null = null;
let clientEditor: IPCClient | null = null;

export async function initialiseIPC() {
  if (!isCoreProcess && !isMainProcess && !isEditorProcess && !isTestProcess) {
    // Throw error when IPC is initialised by an unknown process
    throw new Error(`unknown process: ${process.argv}`);
  }
  if (isCoreProcess || isTestProcess) {
    serverCore = new IPCServer();
    await serverCore.start(portCore);
  }
  if (isMainProcess) {
    serverMain = new IPCServer();
    await serverMain.start(portMain);
  }
  if (isEditorProcess) {
    clientEditor = new IPCClient();
    await clientEditor.connect();
  }
  allServers = serverCore || serverMain;
  forwardLogs();
}

export function forwardLogs() {
  if (!isEditorProcess) {
    const debugLog = Debug.log;
    Debug.log = function(format: string, ...args: any[]) {
      // tslint:disable-next-line:no-this-assignment
      const { namespace } = this;
      const s = format.trim();
      sendLog({ namespace, message: s.substr(s.indexOf(' ') + 1) });
      return debugLog(format, ...args);
    };
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Serialisation
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function serialiseCocoonNode(cocoonNode: CocoonNode) {
  return {
    defaultPort: cocoonNode.defaultPort,
    in: cocoonNode.in,
    out: cocoonNode.out,
    persist: cocoonNode.persist,
    supportedViewStates: cocoonNode.supportedViewStates,
  };
}

export function deserialiseCocoonNode(
  serialisedCocoonNode: ReturnType<typeof serialiseCocoonNode>
) {
  return serialisedCocoonNode as CocoonNode;
}

export function serialiseNode(node: GraphNode) {
  return isCoreProcess
    ? {
        ...node,
        cocoonNode:
          node.cocoonNode === undefined
            ? undefined
            : serialiseCocoonNode(node.cocoonNode),
        state: {
          ...node.state,
          // Reduce cache information to a boolean
          cache: node.state.cache
            ? Object.keys(node.state.cache).reduce((cache, key) => {
                cache[key] = true;
                return cache;
              }, {})
            : undefined,
          // Serialise error
          error:
            node.state.error === undefined
              ? undefined
              : serializeError(node.state.error),
          // Reduce view data to a boolean
          viewData: Boolean(node.state.viewData),
        },
      }
    : {
        definition: node.definition,
        hot: node.hot,
        id: node.id,
      };
}

export function deserialiseNode(
  serialisedNode: ReturnType<typeof serialiseNode>
) {
  return serialisedNode as Partial<GraphNode>;
}

export function serialiseGraph(graph: Graph) {
  return graph.nodes.map(node => serialiseNode(node));
}

export function deserialiseGraph(
  serialisedGraph: ReturnType<typeof serialiseGraph>
) {
  const nodes = serialisedGraph.map(node => deserialiseNode(node));
  return createGraphFromNodes(nodes as GraphNode[]);
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

export interface UpdateDefinitionsArgs {
  definitions?: string;
}
export function onUpdateDefinitions(callback: Callback<UpdateDefinitionsArgs>) {
  return serverCore!.registerCallback('update-definitions', callback);
}
export function sendUpdateDefinitions(args: UpdateDefinitionsArgs = {}) {
  if (isCoreProcess) {
    serverCore!.emit('update-definitions', args);
  } else if (isEditorProcess) {
    clientEditor!.sendCore('update-definitions', args);
  }
}
export function registerUpdateDefinitions(
  callback: Callback<UpdateDefinitionsArgs>
) {
  return clientEditor!.registerCallbackCore(`update-definitions`, callback);
}
export function unregisterUpdateDefinitions(
  callback: Callback<UpdateDefinitionsArgs>
) {
  clientEditor!.unregisterCallbackCore(`update-definitions`, callback);
}

export interface RequestDefinitionsResponseArgs {
  definitions?: string;
}
export function onRequestDefinitions(
  callback: Callback<null, RequestDefinitionsResponseArgs>
) {
  return serverCore!.registerCallback('request-definitions', callback);
}
export function sendRequestDefinitions(
  callback: Callback<RequestDefinitionsResponseArgs>
) {
  clientEditor!.requestCore('request-definitions', null, callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Editor
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface RequestCoreURIResponseArgs {
  uri?: string;
}
export function onRequestCoreURI(
  callback: Callback<null, RequestCoreURIResponseArgs>
) {
  return serverMain!.registerCallback('request-core-uri', callback);
}
export function sendRequestCoreURI(): Promise<RequestCoreURIResponseArgs> {
  return clientEditor!.requestMain('request-core-uri');
}

export interface RequestPortDataArgs {
  nodeId: string;
  port: PortInfo;
}
export interface RequestPortDataResponseArgs {
  data?: any;
}
export function onRequestPortData(
  callback: Callback<RequestPortDataArgs, RequestPortDataResponseArgs>
) {
  return serverCore!.registerCallback('request-port-data', callback);
}
export function sendRequestPortData(
  args: RequestPortDataArgs,
  callback: Callback<RequestPortDataResponseArgs>
) {
  clientEditor!.requestCore('request-port-data', args, callback);
}

export interface SyncGraphArgs {
  registry: CocoonRegistry;
  serialisedGraph: ReturnType<typeof serialiseGraph>;
}
export function onSyncGraph(callback: Callback<SyncGraphArgs>) {
  serverCore!.registerCallback('sync-graph', callback);
}
export function sendSyncGraph(args: SyncGraphArgs) {
  if (isCoreProcess) {
    serverCore!.emit('sync-graph', args);
  } else if (isEditorProcess) {
    clientEditor!.sendCore('sync-graph');
  }
}
export function registerSyncGraph(callback: Callback<SyncGraphArgs>) {
  return clientEditor!.registerCallbackCore(`sync-graph`, callback);
}
export function unregisterSyncGraph(callback: Callback<SyncGraphArgs>) {
  clientEditor!.unregisterCallbackCore(`sync-graph`, callback);
}

export interface RunProcessArgs {
  command: string;
  args?: string[];
}
export function onRunProcess(callback: Callback<RunProcessArgs>) {
  return serverCore!.registerCallback('run-process', callback);
}
export function sendRunProcess(args: RunProcessArgs) {
  clientEditor!.sendCore('run-process', args);
}

export interface InsertColumnArgs {
  beforeColumn: number;
}
export function onInsertColumn(callback: Callback<InsertColumnArgs>) {
  return serverCore!.registerCallback('insert-column', callback);
}
export function sendInsertColumn(args: InsertColumnArgs) {
  clientEditor!.sendCore('insert-column', args);
}

export interface InsertRowArgs {
  beforeRow: number;
}
export function onInsertRow(callback: Callback<InsertRowArgs>) {
  return serverCore!.registerCallback('insert-column', callback);
}
export function sendInsertRow(args: InsertRowArgs) {
  clientEditor!.sendCore('insert-column', args);
}

export interface FocusNodeArgs {
  nodeId: string;
}
export function sendFocusNode(args: FocusNodeArgs) {
  clientEditor!.invoke('focus-node', args);
}
export function registerFocusNode(callback: Callback<FocusNodeArgs>) {
  return clientEditor!.registerCallbackCore(`focus-node`, callback);
}
export function unregisterFocusNode(callback: Callback<FocusNodeArgs>) {
  return clientEditor!.unregisterCallbackCore(`focus-node`, callback);
}

export function sendSaveDefinitions() {
  clientEditor!.invoke('save-definitions');
}
export function registerSaveDefinitions(callback: Callback) {
  return clientEditor!.registerCallbackCore(`save-definitions`, callback);
}
export function unregisterSaveDefinitions(callback: Callback) {
  return clientEditor!.unregisterCallbackCore(`save-definitions`, callback);
}

export interface OpenFileArgs {
  uri: string;
}
export function onOpenFile(callback: Callback<OpenFileArgs>) {
  return serverCore!.registerCallback('open-file', callback);
}
export function sendOpenFile(args: OpenFileArgs) {
  clientEditor!.sendCore('open-file', args);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Data View
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface ChangeNodeViewStateArgs {
  nodeId: string;
  viewState: object;
}
export function onChangeNodeViewState(
  callback: Callback<ChangeNodeViewStateArgs>
) {
  return serverCore!.registerCallback('change-node-view-state', callback);
}
export function sendChangeNodeViewState(args: ChangeNodeViewStateArgs) {
  clientEditor!.sendCore('change-node-view-state', args);
}

export interface QueryNodeViewArgs {
  nodeId: string;
  query: any;
}
export interface QueryNodeViewResponseArgs {
  data?: any;
}
export function onQueryNodeView(
  callback: Callback<QueryNodeViewArgs, QueryNodeViewResponseArgs>
) {
  return serverCore!.registerCallback(`query-node-view`, callback);
}
export function sendQueryNodeView(
  args: QueryNodeViewArgs,
  callback: Callback<QueryNodeViewResponseArgs>
) {
  clientEditor!.requestCore('query-node-view', args, callback);
}

export interface QueryNodeViewDataArgs {
  nodeId: string;
}
export interface QueryNodeViewDataResponseArgs {
  viewData: any;
}
export function onQueryNodeViewData(
  callback: Callback<QueryNodeViewDataArgs, QueryNodeViewDataResponseArgs>
) {
  return serverCore!.registerCallback(`query-node-view-data`, callback);
}
export function sendQueryNodeViewData(
  args: QueryNodeViewDataArgs,
  callback: Callback<QueryNodeViewDataResponseArgs>
) {
  clientEditor!.requestCore('query-node-view-data', args, callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface ProcessNodeArgs {
  nodeId: string;
}
export function onProcessNode(callback: Callback<ProcessNodeArgs>) {
  serverCore!.registerCallback('process-node', callback);
}
export function sendProcessNode(args: ProcessNodeArgs) {
  clientEditor!.sendCore('process-node', args);
}

export interface ProcessNodeIfNecessaryArgs {
  nodeId: string;
}
export function onProcessNodeIfNecessary(
  callback: Callback<ProcessNodeIfNecessaryArgs>
) {
  serverCore!.registerCallback('process-node-if-necessary', callback);
}
export function sendProcessNodeIfNecessary(args: ProcessNodeIfNecessaryArgs) {
  clientEditor!.sendCore('process-node-if-necessary', args);
}

export interface SyncNodeArgs {
  serialisedNode: ReturnType<typeof serialiseNode>;
}
export function onSyncNode(callback: Callback<SyncNodeArgs>) {
  serverCore!.registerCallback('sync-node', callback);
}
export function sendSyncNode(args: SyncNodeArgs) {
  if (isCoreProcess) {
    serverCore!.emit(`sync-node/${_.get(args.serialisedNode, 'id')}`, args);
  } else if (isEditorProcess) {
    clientEditor!.sendCore('sync-node', args);
  }
}
export function registerSyncNode(
  nodeId: string,
  callback: Callback<SyncNodeArgs>
) {
  return clientEditor!.registerCallbackCore(`sync-node/${nodeId}`, callback);
}
export function unregisterSyncNode(
  nodeId: string,
  callback: Callback<SyncNodeArgs>
) {
  clientEditor!.unregisterCallbackCore(`sync-node/${nodeId}`, callback);
}

export interface RequestNodeSyncArgs {
  nodeId: string;
  syncId?: number;
}
export function onRequestNodeSync(callback: Callback<RequestNodeSyncArgs>) {
  serverCore!.registerCallback('request-node-sync', callback);
}
export function sendRequestNodeSync(args: RequestNodeSyncArgs) {
  clientEditor!.sendCore('request-node-sync', args);
}

export interface UpdateNodeProgressArgs {
  summary?: string;
  percent?: number;
}
export function sendUpdateNodeProgress(
  nodeId: string,
  args: UpdateNodeProgressArgs
) {
  serverCore!.emit(`update-node-progress/${nodeId}`, args);
}
export function registerUpdateNodeProgress(
  nodeId: string,
  callback: Callback<UpdateNodeProgressArgs>
) {
  return clientEditor!.registerCallbackCore(
    `update-node-progress/${nodeId}`,
    callback
  );
}
export function unregisterUpdateNodeProgress(
  nodeId: string,
  callback: Callback<UpdateNodeProgressArgs>
) {
  clientEditor!.unregisterCallbackCore(
    `update-node-progress/${nodeId}`,
    callback
  );
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
  port: PortInfo;
}
export function onRemoveEdge(callback: Callback<RemoveEdgeArgs>) {
  serverCore!.registerCallback('remove-edge', callback);
}
export function sendRemoveEdge(args: RemoveEdgeArgs) {
  clientEditor!.sendCore('remove-edge', args);
}

export interface ClearPersistedCacheArgs {
  nodeId: string;
}
export function onClearPersistedCache(
  callback: Callback<ClearPersistedCacheArgs>
) {
  serverCore!.registerCallback('clear-persisted-cache', callback);
}
export function sendClearPersistedCache(args: ClearPersistedCacheArgs) {
  clientEditor!.sendCore('clear-persisted-cache', args);
}

export function onPurgeCache(callback: Callback) {
  serverCore!.registerCallback('purge-cache', callback);
}
export function sendPurgeCache() {
  clientEditor!.sendCore('purge-cache');
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Views
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface CreateViewArgs {
  type: string;
  nodeId: string;
  port?: PortInfo;
}
export function onCreateView(callback: Callback<CreateViewArgs>) {
  serverCore!.registerCallback('create-view', callback);
}
export function sendCreateView(args: CreateViewArgs) {
  clientEditor!.sendCore('create-view', args);
}

export interface RemoveViewArgs {
  nodeId: string;
}
export function onRemoveView(callback: Callback<RemoveViewArgs>) {
  serverCore!.registerCallback('remove-view', callback);
}
export function sendRemoveView(args: RemoveViewArgs) {
  clientEditor!.sendCore('remove-view', args);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Errors & Logs
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface ErrorArgs {
  error: ErrorObject;
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
  message: string;
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

export interface RequestMemoryUsageResponseArgs {
  process: 'main' | 'core';
  memoryUsage: NodeJS.MemoryUsage;
}
export function onRequestMemoryUsage(
  callback: Callback<null, RequestMemoryUsageResponseArgs>
) {
  return allServers!.registerCallback('request-memory-usage', callback);
}
export function sendRequestMemoryUsage(
  callback: Callback<RequestMemoryUsageResponseArgs>
) {
  clientEditor!.requestCore('request-memory-usage', undefined, callback);
  clientEditor!.requestMain('request-memory-usage', undefined, callback);
}
