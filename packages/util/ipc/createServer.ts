import { WebsocketCallback, WebsocketData } from '@cocoon/types';

type wsServer = new (
  options: import('ws').ServerOptions
) => import('ws').Server;

export default async function(
  ws: wsServer,
  port: number,
  debug: WebSocketServer['debug']
) {
  return new WebSocketServer(ws, port, debug).start();
}

export class WebSocketServer {
  debug: import('debug').Debugger;
  callbacks: { [name: string]: WebsocketCallback[] | undefined } = {};
  port: number;
  server: import('ws').Server;
  sockets: { [name: string]: Array<import('ws')> | undefined } = {};

  constructor(ws: wsServer, port: number, debug: WebSocketServer['debug']) {
    this.debug = debug;
    this.port = port;
    this.server = new ws({ port });
  }

  start(): Promise<this> {
    return new Promise(resolve => {
      this.debug(`created IPC server on port "${this.port}"`);
      this.server.on('connection', socket => {
        this.debug(`socket connected on port "${this.port}"`);
        socket.on('message', (data: string) => {
          const { action, channel, id, payload } = JSON.parse(
            data
          ) as WebsocketData;
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
    const promise = new Promise(resolve => {
      // this.debug(`emitting event on channel "${channel}"`, payload);
      const data: WebsocketData = {
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

  registerCallback(channel: string, callback: WebsocketCallback) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel]!.push(callback);
    return callback;
  }

  unregisterCallback(channel: string, callback: WebsocketCallback) {
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
