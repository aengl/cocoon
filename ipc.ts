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

export function coreOnOpenDefinitions(callback: Callback<OpenDefinitionsArgs>) {
  serverCore!.registerCallback('open-definitions', callback);
}

export function sendOpenDefinitions(args: OpenDefinitionsArgs) {
  new IPCClient('open-definitions').connectCore(s => {
    s.send(args);
    s.close();
  });
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Definitions
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface GraphChangedArgs {
  definitions: string;
  definitionsPath: string;
}

export function coreSendGraphChanged(args: GraphChangedArgs) {
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
  message: string;
}

export function coreSendError(args: ErrorArgs) {
  serverCore!.emit('error', args);
}

export function registerError(callback: Callback<ErrorArgs>) {
  return new IPCClient('error', callback).connectCore();
}

export function unregisterError(client: IPCClient) {
  client.unregister();
  return null;
}
