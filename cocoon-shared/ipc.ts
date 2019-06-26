import {
  CocoonNode,
  Graph,
  GraphNode,
  GridPosition,
  PortInfo,
  ProcessName,
} from '@cocoon/types';
import Debug from 'debug';
import _ from 'lodash';
import serializeError, { ErrorObject } from 'serialize-error';
import WebSocketAsPromised from 'websocket-as-promised';
import WebSocket from 'ws';
import { createGraphFromNodes } from './graph';
import { CocoonRegistry } from './registry';

const debug = Debug('shared:ipc');

export type Callback<Args = any, Response = any> = (
  args: Args
) => Response | Promise<Response>;

interface IPCData<T = any> {
  id?: number;
  action?: 'register' | 'unregister';
  channel: string;
  payload: T;
}

const state: {
  serverCocoon: IPCServer | null;
  serverEditor: IPCServer | null;
  clientWeb: IPCClient | null;
  processName: ProcessName;
} = {
  serverCocoon: null,
  serverEditor: null,
  clientWeb: null,
  processName: ProcessName.Unknown,
};

const isCocoonProcess = () => state.processName === ProcessName.Cocoon;
const isEditorProcess = () => state.processName === ProcessName.CocoonEditor;
const isUIProcess = () => state.processName === ProcessName.CocoonEditorUI;
const isTestProcess = () =>
  Boolean(process.argv[1] && process.argv[1].match('/ava/'));

const anyServer = () => state.serverCocoon || state.serverEditor;

const portCocoon = 22448;
const portEditor = 22449;

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
      debug(`created IPC server on "${state.processName}"`);
      this.server.on('connection', socket => {
        debug(`socket connected on "${state.processName}"`);
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
          debug(`socket closed on "${state.processName}"`);
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
  reconnectTimeout?: number | NodeJS.Timeout;
  socketCocoon: WebSocketAsPromised | null = null;
  socketEditor: WebSocketAsPromised = this.createSocket(
    `ws://127.0.0.1:${portEditor}/`
  );

  async connect() {
    // Connect to the editor process first to query it for the Cocoon address
    await this.socketEditor.open();
    const response = await sendRequestCocoonUri();
    // Connect to Cocoon
    this.socketCocoon = this.createSocket(
      response.uri || `ws://127.0.0.1:${portCocoon}/`
    );
    await this.socketCocoon.open();
  }

  sendToCocoon(channel: string, payload?: any) {
    this.socketCocoon!.sendPacked({ channel, payload });
  }

  sendToEditor(channel: string, payload?: any) {
    this.socketEditor.sendPacked({ channel, payload });
  }

  invoke(channel: string, payload?: any) {
    const callbacks = this.callbacks[channel];
    if (callbacks !== undefined) {
      callbacks.forEach(callback => callback(payload));
    }
    return callbacks;
  }

  async requestFromCocoon<ResponseArgs = any>(
    channel: string,
    payload?: any,
    callback?: Callback<ResponseArgs>
  ) {
    const result: IPCData<ResponseArgs> = await this.socketCocoon!.sendRequest({
      channel,
      payload,
    });
    if (callback) {
      callback(result.payload);
    }
    return result.payload;
  }

  async requestFromEditor<ResponseArgs = any>(
    channel: string,
    payload?: any,
    callback?: Callback<ResponseArgs>
  ) {
    const result: IPCData<ResponseArgs> = await this.socketEditor.sendRequest({
      channel,
      payload,
    });
    if (callback) {
      callback(result.payload);
    }
    return result.payload as ResponseArgs;
  }

  registerCallbackOnCocoon(channel: string, callback: Callback) {
    return this.registerCallback(channel, callback, this.socketCocoon!);
  }

  registerCallbackOnEditor(channel: string, callback: Callback) {
    return this.registerCallback(channel, callback, this.socketEditor!);
  }

  unregisterCallbackOnCocoon(channel: string, callback: Callback) {
    this.unregisterCallback(channel, callback, this.socketCocoon!);
  }

  unregisterCallbackOnEditor(channel: string, callback: Callback) {
    this.unregisterCallback(channel, callback, this.socketEditor!);
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
        if (reconnectCallback && socket === this.socketCocoon) {
          // TODO: Ideally we only fire the reconnect callback once all sockets
          // are connected, but for some reason I couldn't get that to work.
          // Thus we only fire for the "cocoon" socket, since it's generally the
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

export async function initialiseIPC(processName: ProcessName) {
  process.title = processName;
  state.processName = processName;
  if (isCocoonProcess() || isTestProcess()) {
    state.serverCocoon = new IPCServer();
    await state.serverCocoon.start(portCocoon);
  }
  if (isEditorProcess()) {
    state.serverEditor = new IPCServer();
    await state.serverEditor.start(portEditor);
  }
  if (isUIProcess()) {
    state.clientWeb = new IPCClient();
    await state.clientWeb.connect();
  } else {
    forwardLogs();
  }
}

export function forwardLogs() {
  const debugLog = Debug.log;
  Debug.log = function(format: string, ...args: any[]) {
    // tslint:disable-next-line:no-this-assignment
    const { namespace } = this as any;
    const s = format.trim();
    sendLog({
      additionalArgs: args.length > 1 ? args.slice(0, args.length - 1) : [],
      message: s.replace(/\s*\[[\d;]+m\w+:\w+\s?/gm, ''),
      namespace,
    });
    return debugLog(format, ...args);
  };
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
  return isCocoonProcess
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
  return state.serverCocoon!.registerCallback('open-definitions', callback);
}
export function sendOpenDefinitions(args: OpenDefinitionsArgs) {
  state.clientWeb!.sendToCocoon('open-definitions', args);
}

export interface UpdateDefinitionsArgs {
  definitions?: string;
}
export function onUpdateDefinitions(callback: Callback<UpdateDefinitionsArgs>) {
  return state.serverCocoon!.registerCallback('update-definitions', callback);
}
export function sendUpdateDefinitions(args: UpdateDefinitionsArgs = {}) {
  if (isCocoonProcess()) {
    state.serverCocoon!.emit('update-definitions', args);
  } else if (isUIProcess()) {
    state.clientWeb!.sendToCocoon('update-definitions', args);
  }
}
export function registerUpdateDefinitions(
  callback: Callback<UpdateDefinitionsArgs>
) {
  return state.clientWeb!.registerCallbackOnCocoon(
    'update-definitions',
    callback
  );
}
export function unregisterUpdateDefinitions(
  callback: Callback<UpdateDefinitionsArgs>
) {
  state.clientWeb!.unregisterCallbackOnCocoon('update-definitions', callback);
}

export interface RequestDefinitionsResponseArgs {
  definitions?: string;
}
export function onRequestDefinitions(
  callback: Callback<null, RequestDefinitionsResponseArgs>
) {
  return state.serverCocoon!.registerCallback('request-definitions', callback);
}
export function sendRequestDefinitions(
  callback: Callback<RequestDefinitionsResponseArgs>
) {
  state.clientWeb!.requestFromCocoon('request-definitions', null, callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Editor
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface RequestCocoonUriResponseArgs {
  uri?: string;
}
export function onRequestCocoonUri(
  callback: Callback<null, RequestCocoonUriResponseArgs>
) {
  return state.serverEditor!.registerCallback('request-cocoon-uri', callback);
}
export function sendRequestCocoonUri(): Promise<RequestCocoonUriResponseArgs> {
  return state.clientWeb!.requestFromEditor('request-cocoon-uri');
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
  return state.serverCocoon!.registerCallback('request-port-data', callback);
}
export function sendRequestPortData(
  args: RequestPortDataArgs,
  callback: Callback<RequestPortDataResponseArgs>
) {
  state.clientWeb!.requestFromCocoon('request-port-data', args, callback);
}

export interface SyncGraphArgs {
  registry: CocoonRegistry;
  serialisedGraph: ReturnType<typeof serialiseGraph>;
}
export function onSyncGraph(callback: Callback<SyncGraphArgs>) {
  state.serverCocoon!.registerCallback('sync-graph', callback);
}
export function sendSyncGraph(args: SyncGraphArgs) {
  if (isCocoonProcess()) {
    state.serverCocoon!.emit('sync-graph', args);
  } else if (isUIProcess()) {
    state.clientWeb!.sendToCocoon('sync-graph');
  }
}
export function registerSyncGraph(callback: Callback<SyncGraphArgs>) {
  return state.clientWeb!.registerCallbackOnCocoon('sync-graph', callback);
}
export function unregisterSyncGraph(callback: Callback<SyncGraphArgs>) {
  state.clientWeb!.unregisterCallbackOnCocoon('sync-graph', callback);
}

export interface RunProcessArgs {
  command: string;
  args?: string[];
}
export function onRunProcess(callback: Callback<RunProcessArgs>) {
  return state.serverCocoon!.registerCallback('run-process', callback);
}
export function sendRunProcess(args: RunProcessArgs) {
  state.clientWeb!.sendToCocoon('run-process', args);
}

export interface ShiftPositionsArgs {
  beforeRow?: number;
  beforeColumn?: number;
  shiftBy: number;
}
export function onShiftPositions(callback: Callback<ShiftPositionsArgs>) {
  return state.serverCocoon!.registerCallback('shift-positions', callback);
}
export function sendShiftPositions(args: ShiftPositionsArgs) {
  state.clientWeb!.sendToCocoon('shift-positions', args);
}

export interface FocusNodeArgs {
  nodeId: string;
}
export function sendFocusNode(args: FocusNodeArgs) {
  state.clientWeb!.invoke('focus-node', args);
}
export function registerFocusNode(callback: Callback<FocusNodeArgs>) {
  return state.clientWeb!.registerCallbackOnCocoon('focus-node', callback);
}
export function unregisterFocusNode(callback: Callback<FocusNodeArgs>) {
  return state.clientWeb!.unregisterCallbackOnCocoon('focus-node', callback);
}

export function sendSaveDefinitions() {
  state.clientWeb!.invoke('save-definitions');
}
export function registerSaveDefinitions(callback: Callback) {
  return state.clientWeb!.registerCallbackOnCocoon(
    'save-definitions',
    callback
  );
}
export function unregisterSaveDefinitions(callback: Callback) {
  return state.clientWeb!.unregisterCallbackOnCocoon(
    'save-definitions',
    callback
  );
}

export interface OpenFileArgs {
  uri: string;
}
export function onOpenFile(callback: Callback<OpenFileArgs>) {
  return state.serverCocoon!.registerCallback('open-file', callback);
}
export function sendOpenFile(args: OpenFileArgs) {
  state.clientWeb!.sendToCocoon('open-file', args);
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
  return state.serverCocoon!.registerCallback(
    'change-node-view-state',
    callback
  );
}
export function sendChangeNodeViewState(args: ChangeNodeViewStateArgs) {
  state.clientWeb!.sendToCocoon('change-node-view-state', args);
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
  return state.serverCocoon!.registerCallback('query-node-view', callback);
}
export function sendQueryNodeView(
  args: QueryNodeViewArgs,
  callback: Callback<QueryNodeViewResponseArgs>
) {
  state.clientWeb!.requestFromCocoon('query-node-view', args, callback);
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
  return state.serverCocoon!.registerCallback('query-node-view-data', callback);
}
export function sendQueryNodeViewData(
  args: QueryNodeViewDataArgs,
  callback: Callback<QueryNodeViewDataResponseArgs>
) {
  state.clientWeb!.requestFromCocoon('query-node-view-data', args, callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface ProcessNodeArgs {
  nodeId: string;
}
export function onProcessNode(callback: Callback<ProcessNodeArgs>) {
  state.serverCocoon!.registerCallback('process-node', callback);
}
export function sendProcessNode(args: ProcessNodeArgs) {
  state.clientWeb!.sendToCocoon('process-node', args);
}

export interface ProcessNodeIfNecessaryArgs {
  nodeId: string;
}
export function onProcessNodeIfNecessary(
  callback: Callback<ProcessNodeIfNecessaryArgs>
) {
  state.serverCocoon!.registerCallback('process-node-if-necessary', callback);
}
export function sendProcessNodeIfNecessary(args: ProcessNodeIfNecessaryArgs) {
  state.clientWeb!.sendToCocoon('process-node-if-necessary', args);
}

export interface SyncNodeArgs {
  serialisedNode: ReturnType<typeof serialiseNode>;
}
export function onSyncNode(callback: Callback<SyncNodeArgs>) {
  state.serverCocoon!.registerCallback('sync-node', callback);
}
export function sendSyncNode(args: SyncNodeArgs) {
  if (isCocoonProcess()) {
    state.serverCocoon!.emit(
      `sync-node/${_.get(args.serialisedNode, 'id')}`,
      args
    );
  } else if (isUIProcess()) {
    state.clientWeb!.sendToCocoon('sync-node', args);
  }
}
export function registerSyncNode(
  nodeId: string,
  callback: Callback<SyncNodeArgs>
) {
  return state.clientWeb!.registerCallbackOnCocoon(
    `sync-node/${nodeId}`,
    callback
  );
}
export function unregisterSyncNode(
  nodeId: string,
  callback: Callback<SyncNodeArgs>
) {
  state.clientWeb!.unregisterCallbackOnCocoon(`sync-node/${nodeId}`, callback);
}

export interface RequestNodeSyncArgs {
  nodeId: string;
  syncId?: number;
}
export function onRequestNodeSync(callback: Callback<RequestNodeSyncArgs>) {
  state.serverCocoon!.registerCallback('request-node-sync', callback);
}
export function sendRequestNodeSync(args: RequestNodeSyncArgs) {
  state.clientWeb!.sendToCocoon('request-node-sync', args);
}

export interface UpdateNodeProgressArgs {
  summary?: string;
  percent?: number;
}
export function sendUpdateNodeProgress(
  nodeId: string,
  args: UpdateNodeProgressArgs
) {
  state.serverCocoon!.emit(`update-node-progress/${nodeId}`, args);
}
export function registerUpdateNodeProgress(
  nodeId: string,
  callback: Callback<UpdateNodeProgressArgs>
) {
  return state.clientWeb!.registerCallbackOnCocoon(
    `update-node-progress/${nodeId}`,
    callback
  );
}
export function unregisterUpdateNodeProgress(
  nodeId: string,
  callback: Callback<UpdateNodeProgressArgs>
) {
  state.clientWeb!.unregisterCallbackOnCocoon(
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
  state.serverCocoon!.registerCallback('create-node', callback);
}
export function sendCreateNode(args: CreateNodeArgs) {
  state.clientWeb!.sendToCocoon('create-node', args);
}

export interface RemoveNodeArgs {
  nodeId: string;
}
export function onRemoveNode(callback: Callback<RemoveNodeArgs>) {
  state.serverCocoon!.registerCallback('remove-node', callback);
}
export function sendRemoveNode(args: RemoveNodeArgs) {
  state.clientWeb!.sendToCocoon('remove-node', args);
}

export interface CreateEdgeArgs {
  fromNodeId: string;
  fromNodePort: string;
  toNodeId: string;
  toNodePort: string;
}
export function onCreateEdge(callback: Callback<CreateEdgeArgs>) {
  state.serverCocoon!.registerCallback('create-edge', callback);
}
export function sendCreateEdge(args: CreateEdgeArgs) {
  state.clientWeb!.sendToCocoon('create-edge', args);
}

export interface RemoveEdgeArgs {
  nodeId: string;
  port: PortInfo;
}
export function onRemoveEdge(callback: Callback<RemoveEdgeArgs>) {
  state.serverCocoon!.registerCallback('remove-edge', callback);
}
export function sendRemoveEdge(args: RemoveEdgeArgs) {
  state.clientWeb!.sendToCocoon('remove-edge', args);
}

export interface ClearPersistedCacheArgs {
  nodeId: string;
}
export function onClearPersistedCache(
  callback: Callback<ClearPersistedCacheArgs>
) {
  state.serverCocoon!.registerCallback('clear-persisted-cache', callback);
}
export function sendClearPersistedCache(args: ClearPersistedCacheArgs) {
  state.clientWeb!.sendToCocoon('clear-persisted-cache', args);
}

export function onPurgeCache(callback: Callback) {
  state.serverCocoon!.registerCallback('purge-cache', callback);
}
export function sendPurgeCache() {
  state.clientWeb!.sendToCocoon('purge-cache');
}

export interface SendToNodeArgs {
  nodeId: string;
  data: any;
}
export function onSendToNode(callback: Callback<SendToNodeArgs>) {
  return state.serverCocoon!.registerCallback(`send-to-node`, callback);
}
export function sendToNode(args: SendToNodeArgs) {
  state.clientWeb!.requestFromCocoon(`send-to-node`, args);
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
  state.serverCocoon!.registerCallback('create-view', callback);
}
export function sendCreateView(args: CreateViewArgs) {
  state.clientWeb!.sendToCocoon('create-view', args);
}

export interface RemoveViewArgs {
  nodeId: string;
}
export function onRemoveView(callback: Callback<RemoveViewArgs>) {
  state.serverCocoon!.registerCallback('remove-view', callback);
}
export function sendRemoveView(args: RemoveViewArgs) {
  state.clientWeb!.sendToCocoon('remove-view', args);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Errors & Logs
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface ErrorArgs {
  error: ErrorObject | null;
}
export function sendError(args: ErrorArgs) {
  state.serverCocoon!.emit('error', args);
}
export function registerError(callback: Callback<ErrorArgs>) {
  return state.clientWeb!.registerCallbackOnCocoon('error', callback);
}
export function unregisterError(callback: Callback<ErrorArgs>) {
  state.clientWeb!.unregisterCallbackOnCocoon('error', callback);
}

export interface LogArgs {
  additionalArgs: any[];
  namespace: string;
  message: string;
}
export function sendLog(args: LogArgs) {
  anyServer()!.emit('log', args);
}
export function registerLog(callback: Callback<LogArgs>) {
  return state.clientWeb!.registerCallbackOnCocoon('log', callback);
}
export function unregisterLog(callback: Callback<LogArgs>) {
  state.clientWeb!.unregisterCallbackOnCocoon('log', callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Memory
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface RequestMemoryUsageResponseArgs {
  process: ProcessName;
  memoryUsage: NodeJS.MemoryUsage;
}
export function onRequestMemoryUsage(
  callback: Callback<null, RequestMemoryUsageResponseArgs>
) {
  return anyServer()!.registerCallback('request-memory-usage', callback);
}
export function sendRequestMemoryUsage(
  callback: Callback<RequestMemoryUsageResponseArgs>
) {
  state.clientWeb!.requestFromCocoon(
    'request-memory-usage',
    undefined,
    callback
  );
  state.clientWeb!.requestFromEditor(
    'request-memory-usage',
    undefined,
    callback
  );
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Registry
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface RequestRegistryResponseArgs {
  registry: CocoonRegistry;
}
export function onRequestRegistry(
  callback: Callback<null, RequestRegistryResponseArgs>
) {
  return state.serverCocoon!.registerCallback('request-registry', callback);
}
export function sendRequestRegistry(
  callback: Callback<RequestRegistryResponseArgs>
) {
  state.clientWeb!.requestFromCocoon('request-registry', undefined, callback);
}
