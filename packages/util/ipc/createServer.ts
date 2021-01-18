import { IPCCallback, IPCData, IPCServer } from '@cocoon/types';

type WebSocketLibrary = {
  Server: new (options: import('ws').ServerOptions) => import('ws').Server;
} & WebSocket;

export default async function (
  ws: WebSocketLibrary,
  port: number,
  debug: WebSocketServer['debug']
): Promise<IPCServer> {
  return new WebSocketServer(ws, port, debug).start();
}

export class WebSocketServer implements IPCServer {
  debug: import('debug').Debugger;
  callbacks: { [name: string]: IPCCallback[] | undefined } = {};
  port: number;
  server: import('ws').Server;
  sockets: { [name: string]: Array<import('ws')> | undefined } = {};
  websocket: WebSocketLibrary;

  constructor(
    ws: WebSocketLibrary,
    port: number,
    debug: WebSocketServer['debug']
  ) {
    this.websocket = ws;
    this.port = port;
    this.debug = debug;
    this.server = new ws.Server({ port });
  }

  start(): Promise<this> {
    return new Promise(resolve => {
      this.debug(`created IPC server on port "${this.port}"`);
      this.server.on('connection', socket => {
        this.debug(`socket connected on port "${this.port}"`);
        socket.on('message', (data: string) => {
          const { action, channel, id, payload } = JSON.parse(data) as IPCData;
          if (action === 'register') {
            this.registerSocket(channel, socket);
          } else if (action === 'unregister') {
            this.unregisterSocket(channel, socket);
          } else {
            // this.debug(`got message on channel "${channel}"`, payload);
            const callbacks = this.callbacks[channel];
            if (callbacks !== undefined) {
              callbacks.forEach(async callback => {
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
          this.debug(`socket closed`);
          Object.keys(this.sockets).forEach(channel =>
            this.unregisterSocket(channel, socket)
          );
        });
      });
      this.server.on('listening', () => resolve(this));
    });
  }

  emit(channel: string, payload: any) {
    return new Promise<void>(resolve => {
      // this.debug(`emitting event on channel "${channel}"`, payload);
      const data: IPCData = {
        channel,
        payload,
      };
      const encodedData = JSON.stringify(data);
      if (this.sockets[channel] !== undefined) {
        this.sockets[channel]!.filter(
          socket => socket.readyState === this.websocket.OPEN
        ).forEach(socket => {
          socket.send(encodedData);
        });
      }
      resolve();
    });
  }

  registerCallback<CallbackType extends IPCCallback = IPCCallback>(
    channel: string,
    callback: CallbackType
  ) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel]!.push(callback);
    return callback;
  }

  unregisterCallback(channel: string, callback: IPCCallback) {
    if (this.callbacks[channel] !== undefined) {
      this.callbacks[channel] = this.callbacks[channel]!.filter(
        c => c !== callback
      );
    }
  }

  private registerSocket(channel: string, socket: import('ws')) {
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

  private unregisterSocket(channel: string, socket: import('ws')) {
    if (this.sockets[channel] !== undefined) {
      this.sockets[channel] = this.sockets[channel]!.filter(s => s !== socket);
    }
  }
}
