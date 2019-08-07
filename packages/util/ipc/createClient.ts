import { WebsocketCallback, WebsocketData, IPCClient } from '@cocoon/types';

type WebSocketAsPromised = new (
  url: string,
  options: import('websocket-as-promised/types/options')
) => import('websocket-as-promised');

export default async function(
  ws: WebSocketAsPromised,
  url: string,
  debug: WebSocketClient['debug']
) {
  return new WebSocketClient(ws, url, debug).connect();
}

export class WebSocketClient implements IPCClient {
  debug: import('debug').Debugger;
  callbacks: { [name: string]: WebsocketCallback[] } = {};
  reconnecting?: boolean;
  socket: import('websocket-as-promised');

  constructor(
    ws: WebSocketAsPromised,
    url: string,
    debug: WebSocketClient['debug']
  ) {
    this.debug = debug;
    this.socket = new ws(url, {
      attachRequestId: (data, id) => ({ id, ...data }),
      extractRequestId: data => data && data.id,
      packMessage: data => JSON.stringify(data),
      unpackMessage: message => JSON.parse(message.toString()),
    });
    this.socket.onUnpackedMessage.addListener(message => {
      const { channel, id, payload } = message as WebsocketData;
      // console.info(`got message on channel ${channel}`, payload);
      // Call registered callbacks
      const callbacks = this.invoke(channel, payload);
      // Make sure we didn't deserialise this message for no reason
      if (id === undefined && callbacks === undefined) {
        throw new Error(`message on channel "${channel}" had no subscriber`);
      }
    });
    // this.socket.onClose.addListener(() => {
    //   if (disconnectCallback) {
    //     disconnectCallback();
    //   }
    //   this.reconnect();
    // });
  }

  async connect() {
    // Connect to the editor process first to query it for the Cocoon address
    await this.socket.open();
  }

  send(channel: string, payload?: any) {
    this.socket.sendPacked({ channel, payload });
  }

  invoke(channel: string, payload?: any) {
    const callbacks = this.callbacks[channel];
    if (callbacks !== undefined) {
      callbacks.forEach(callback => callback(payload));
    }
    return callbacks;
  }

  async request<ResponseArgs = any>(
    channel: string,
    payload?: any,
    callback?: WebsocketCallback<ResponseArgs>
  ) {
    const result: WebsocketData<ResponseArgs> = await this.socket.sendRequest({
      channel,
      payload,
    });
    if (callback) {
      callback(result.payload);
    }
    return result.payload as ResponseArgs;
  }

  registerCallback<CallbackType extends WebsocketCallback = WebsocketCallback>(
    channel: string,
    callback: CallbackType
  ) {
    if (this.callbacks[channel] === undefined) {
      this.callbacks[channel] = [];
    }
    this.callbacks[channel].push(callback);
    this.socket.sendPacked({
      action: 'register',
      channel,
      payload: null,
    });
    return callback;
  }

  unregisterCallback(channel: string, callback: WebsocketCallback) {
    if (this.callbacks[channel] !== undefined) {
      this.callbacks[channel] = this.callbacks[channel].filter(
        c => c !== callback
      );
      this.socket.sendPacked({
        action: 'unregister',
        channel,
        payload: null,
      });
    }
  }

  // private async reconnect() {
  //   if (!this.reconnecting) {
  //     this.reconnecting = true;
  //     try {
  //       state.debug(`reconnecting`);
  //       await Promise.all([this.socketCocoon, this.socket].map(s => s!.open()));
  //       if (reconnectCallback) {
  //         this.reconnecting = false;
  //         state.debug(`sucessfully reconnected`);
  //         reconnectCallback();
  //       }
  //     } catch (error) {
  //       state.debug(`connection failed`, error);
  //       setTimeout(() => {
  //         this.reconnecting = false;
  //         this.reconnect();
  //       }, 500);
  //     }
  //   }
  // }
}
