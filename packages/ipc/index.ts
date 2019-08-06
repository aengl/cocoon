import {
  CocoonNode,
  CocoonRegistry,
  DebugFunction,
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
import { createGraphFromNodes } from '../cocoon/src/graph';

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
  clientWeb: IPCClient | null;
  debug: DebugFunction;
  processName: ProcessName;
  serverCocoon: IPCServer | null;
  serverEditor: IPCServer | null;
} = {
  clientWeb: null,
  debug: () => null,
  processName: ProcessName.Unknown,
  serverCocoon: null,
  serverEditor: null,
};

const isNode = () =>
  state.processName === ProcessName.Cocoon ||
  state.processName === ProcessName.CocoonEditor;
const isBrowser = () => state.processName === ProcessName.CocoonEditorUI;

const anyServer = () => state.serverCocoon || state.serverEditor;

const portCocoon = 22244;
const portEditor = 22245;

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
      state.debug(`created IPC server on port "${port}"`);
      this.server.on('connection', socket => {
        state.debug(`socket connected on port "${port}"`);
        socket.on('message', (data: string) => {
          const { action, channel, id, payload } = JSON.parse(data) as IPCData;
          if (action === 'register') {
            this.registerSocket(channel, socket);
          } else if (action === 'unregister') {
            this.unregisterSocket(channel, socket);
          } else {
            // state.debug(`got message on channel "${channel}"`, payload);
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
          state.debug(`socket closed on "${state.processName}"`);
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
      // state.debug(`emitting event on channel "${channel}"`, payload);
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
  reconnecting?: boolean;
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
      this.reconnect();
    });
    return socket;
  }

  private async reconnect() {
    if (!this.reconnecting) {
      this.reconnecting = true;
      try {
        state.debug(`reconnecting`);
        await Promise.all(
          [this.socketCocoon, this.socketEditor].map(s => s!.open())
        );
        if (reconnectCallback) {
          this.reconnecting = false;
          state.debug(`sucessfully reconnected`);
          reconnectCallback();
        }
      } catch (error) {
        state.debug(`connection failed`, error);
        setTimeout(() => {
          this.reconnecting = false;
          this.reconnect();
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
  if (processName === ProcessName.Cocoon) {
    state.serverCocoon = new IPCServer();
    await state.serverCocoon.start(portCocoon);
  } else if (processName === ProcessName.CocoonEditor) {
    state.serverEditor = new IPCServer();
    await state.serverEditor.start(portEditor);
  } else if (processName === ProcessName.CocoonEditorUI) {
    state.clientWeb = new IPCClient();
    await state.clientWeb.connect();
  } else {
    throw new Error(`unknown process: ${processName}`);
  }
}

export function logIPC(debug: DebugFunction) {
  state.debug = debug;
}

export function setupLogForwarding(debugModule: typeof Debug) {
  const debugLog = debugModule.log;
  debugModule.log = function(this: any, message: string, ...args: any[]) {
    // tslint:disable-next-line:no-this-assignment
    const { namespace } = this;
    sendLog({
      additionalArgs: args.length > 1 ? args.slice(0, args.length - 1) : [],
      message: message
        .replace(/[\x00-\x1F\s]*\[([\d]+;?)+m(\w+:\w+)?/gm, '')
        .trim(),
      namespace,
    });
    // In the console we suppress the `...args`
    return debugLog(message);
  };
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Serialisation
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function serialiseCocoonNode(cocoonNode: CocoonNode) {
  return _.omitBy(cocoonNode, _.isFunction);
}

export function serialiseNode(node: GraphNode) {
  return isNode
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
 * Cocoon File
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface OpenCocoonFileArgs {
  cocoonFilePath: string;
}
export function onOpenCocoonFile(callback: Callback<OpenCocoonFileArgs>) {
  return state.serverCocoon!.registerCallback('open-cocoon-file', callback);
}
export function sendOpenCocoonFile(args: OpenCocoonFileArgs) {
  state.clientWeb!.sendToCocoon('open-cocoon-file', args);
}

export interface UpdateCocoonFileArgs {
  contents?: string;
}
export function onUpdateCocoonFile(callback: Callback<UpdateCocoonFileArgs>) {
  return state.serverCocoon!.registerCallback('update-cocoon-file', callback);
}
export function sendUpdateCocoonFile(args: UpdateCocoonFileArgs = {}) {
  if (isNode()) {
    state.serverCocoon!.emit('update-cocoon-file', args);
  } else if (isBrowser()) {
    state.clientWeb!.sendToCocoon('update-cocoon-file', args);
  }
}
export function registerUpdateCocoonFile(
  callback: Callback<UpdateCocoonFileArgs>
) {
  return state.clientWeb!.registerCallbackOnCocoon(
    'update-cocoon-file',
    callback
  );
}
export function unregisterUpdateCocoonFile(
  callback: Callback<UpdateCocoonFileArgs>
) {
  state.clientWeb!.unregisterCallbackOnCocoon('update-cocoon-file', callback);
}

export interface RequestCocoonFileResponseArgs {
  contents?: string;
}
export function onRequestCocoonFile(
  callback: Callback<null, RequestCocoonFileResponseArgs>
) {
  return state.serverCocoon!.registerCallback('request-cocoon-file', callback);
}
export function sendRequestCocoonFile(
  callback: Callback<RequestCocoonFileResponseArgs>
) {
  state.clientWeb!.requestFromCocoon('request-cocoon-file', null, callback);
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
  sampleSize?: number;
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

export interface DumpPortDataArgs {
  nodeId: string;
  port: PortInfo;
}
export function onDumpPortData(callback: Callback<DumpPortDataArgs>) {
  return state.serverCocoon!.registerCallback('dump-port-data', callback);
}
export function sendDumpPortData(args: DumpPortDataArgs) {
  state.clientWeb!.requestFromCocoon('dump-port-data', args);
}

export interface SyncGraphArgs {
  registry: CocoonRegistry;
  serialisedGraph: ReturnType<typeof serialiseGraph>;
}
export function onSyncGraph(callback: Callback<SyncGraphArgs>) {
  state.serverCocoon!.registerCallback('sync-graph', callback);
}
export function sendSyncGraph(args: SyncGraphArgs) {
  if (isNode()) {
    state.serverCocoon!.emit('sync-graph', args);
  } else if (isBrowser()) {
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

// export function sendSaveDefinitions() {
//   state.clientWeb!.invoke('save-definitions');
// }
// export function registerSaveDefinitions(callback: Callback) {
//   return state.clientWeb!.registerCallbackOnCocoon(
//     'save-definitions',
//     callback
//   );
// }
// export function unregisterSaveDefinitions(callback: Callback) {
//   return state.clientWeb!.unregisterCallbackOnCocoon(
//     'save-definitions',
//     callback
//   );
// }

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

export interface HighlightInViewsArgs {
  data: any;
  senderNodeId: string;
}
export function onHighlightInViews(callback: Callback<HighlightInViewsArgs>) {
  return state.serverCocoon!.registerCallback('highlight-in-views', callback);
}
export function sendHighlightInViews(args: HighlightInViewsArgs) {
  isNode()
    ? state.serverCocoon!.emit('highlight-in-views', args)
    : state.clientWeb!.sendToCocoon('highlight-in-views', args);
}
export function registerHighlightInViews(
  callback: Callback<HighlightInViewsArgs>
) {
  return state.clientWeb!.registerCallbackOnCocoon(
    'highlight-in-views',
    callback
  );
}
export function unregisterHighlightInViews(
  callback: Callback<HighlightInViewsArgs>
) {
  state.clientWeb!.unregisterCallbackOnCocoon('highlight-in-views', callback);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Processing & Execution Plan
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

export function onStopExecutionPlan(callback: Callback) {
  state.serverCocoon!.registerCallback('stop-execution-plan', callback);
}
export function sendStopExecutionPlan() {
  state.clientWeb!.sendToCocoon('stop-execution-plan');
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface SyncNodeArgs {
  serialisedNode: ReturnType<typeof serialiseNode>;
}
export function onSyncNode(callback: Callback<SyncNodeArgs>) {
  state.serverCocoon!.registerCallback('sync-node', callback);
}
export function sendSyncNode(args: SyncNodeArgs) {
  if (isNode()) {
    state.serverCocoon!.emit(
      `sync-node/${_.get(args.serialisedNode, 'id')}`,
      args
    );
  } else if (isBrowser()) {
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
  summary?: string | null;
  percent?: number | null;
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

export function onReloadRegistry(callback: Callback) {
  return state.serverCocoon!.registerCallback('reload-registry', callback);
}
export function sendReloadRegistry() {
  state.clientWeb!.sendToCocoon('reload-registry');
}
