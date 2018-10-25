import WebSocket from 'ws';

const debug = require('debug')('cocoon:ipc');

interface IPCData {
  channel: string;
  action: 'register' | 'unregister' | 'send';
  payload?: any;
}

type Callback<T = any> = (args: T) => void;

debug(process.argv);

export const isMain = process.argv[0].endsWith('Electron');
export const isRenderer =
  process.argv[0].endsWith('Electron Helper') &&
  process.argv[1] === '--type=renderer';
export const isCore = !isMain && !isRenderer;

const portCore = 22448;
const portMain = 22449;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * IPC Server
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export class IPCServer {
  server: WebSocket.Server;
  sockets: { [name: string]: WebSocket[] } = {};
  callbacks: { [name: string]: Callback[] } = {};

  constructor(port: number) {
    debug(`created IPC server`);
    this.server = new WebSocket.Server({ port });
    this.server.on('connection', socket => {
      socket.on('message', (data: string) => {
        const { channel, action, payload } = JSON.parse(data) as IPCData;
        debug(`got "${action}" request on channel "${channel}"`);
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
    debug(`emitting event on channel "${channel}"`);
    debug(data);
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

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Server instances
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const serverCore = isCore ? new IPCServer(portCore) : null;
const serverMain = isMain ? new IPCServer(portMain) : null;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
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
    const data: IPCData = { action: 'send', channel: this.channel, payload };
    this.socket!.send(JSON.stringify(data));
    return this;
  }

  register() {
    const data: IPCData = { action: 'register', channel: this.channel };
    this.socket!.send(JSON.stringify(data));
    return this;
  }

  unregister() {
    const data: IPCData = { action: 'unregister', channel: this.channel };
    this.socket!.send(JSON.stringify(data));
    this.close();
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
    debug(`created IPC client at "${this.socket.url}"`);
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
        debug(`got a message on channel "${this.channel}"`);
        const data = JSON.parse(message.data);
        debug(data);
        this.callback!(data);
      });
    }
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
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

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface NodeStatusUpdateArgs {
  status: import('./core/graph').NodeStatus;
}

export function onNodeStatusUpdate(
  nodeId: string,
  callback: Callback<NodeStatusUpdateArgs>
) {
  serverCore!.registerCallback(`node-status-update/${nodeId}`, callback);
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
  return null;
}

export interface NodeEvaluatedArgs {
  summary?: string;
}

export function onNodeEvaluated(
  nodeId: string,
  callback: Callback<NodeEvaluatedArgs>
) {
  serverCore!.registerCallback(`node-evaluated/${nodeId}`, callback);
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
  return null;
}

export interface NodeErrorArgs {
  error: Error;
}

export function onNodeError(nodeId: string, callback: Callback<NodeErrorArgs>) {
  serverCore!.registerCallback(`node-error/${nodeId}`, callback);
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
  return null;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
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
  return null;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Errors
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
  return null;
}
