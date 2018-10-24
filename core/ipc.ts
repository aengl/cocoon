import WebSocket from 'ws';

const debug = require('debug')('cocoon:ipc');

interface IPCData {
  channel: string;
  action: 'register' | 'unregister' | 'send';
  payload: any;
}

type Callback<T = any> = (args: T) => void;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * IPC Server
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export class IPCServer {
  server: WebSocket.Server = new WebSocket.Server({ port: 22448 });
  sockets: { [name: string]: WebSocket[] } = {};
  callbacks: { [name: string]: Callback[] } = {};

  constructor() {
    debug(`created IPC server`);
    this.server.on('connection', (webSocket, request) => {
      debug(`client connected`, request.url);
      // if (!request.url) {
      //   throw Error();
      // }
      // const channel = request.url.slice(1);
      webSocket.on('message', (data: string) => {
        const { channel, action, payload } = JSON.parse(data) as IPCData;
        debug(`got ipc data on channel "${channel}"`);
        if (action === 'register') {
          this.registerSocket(channel, webSocket);
        } else if (action === 'unregister') {
          this.unregisterSocket(channel, webSocket);
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
      this.sockets[channel].forEach(ws => ws.send(encodedData));
    }
  }

  registerSocket(channel: string, socket: WebSocket) {
    if (this.sockets[channel] === undefined) {
      this.sockets[channel] = [];
    }
    this.sockets[channel].push(socket);
  }

  unregisterSocket(channel: string, socket: WebSocket) {
    if (this.sockets[channel]) {
      this.sockets[channel] = this.sockets[channel].filter(c => c !== socket);
    }
  }

  registerCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel].push(callback);
  }

  unregisterCallback(channel: string, callback: Callback) {
    if (this.callbacks[channel]) {
      this.callbacks[channel] = this.callbacks[channel].filter(
        c => c !== callback
      );
    }
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * IPC Client
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export class IPCClient {
  socket: WebSocket;

  constructor(channel: string) {
    this.socket = new WebSocket(`ws://localhost:22448/${channel}`);
    debug(`created IPC client at "${this.socket.url}"`);
  }

  send(data: IPCData) {
    this.socket.send(JSON.stringify(data));
  }

  close() {
    this.socket.close();
  }
}

async function sendOnce(channel: string, payload: any) {
  const client = new IPCClient(channel);
  client.socket.addEventListener('open', () => {
    client.send({
      action: 'send',
      channel,
      payload,
    });
    client.close();
  });
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Editor
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface OpenDefinitionsArgs {
  definitionsPath: string;
}

export function onOpenDefinitions(
  server: IPCServer,
  callback: Callback<OpenDefinitionsArgs>
) {
  server.registerCallback('open-definitions', callback);
}

export function sendOpenDefinitions(args: OpenDefinitionsArgs) {
  sendOnce('open-definitions', args);
}
