import { IPCCallback, IPCData, IPCClient } from '@cocoon/types';

type WebSocketAsPromised = new (
  url: string,
  options: import('websocket-as-promised/types/options')
) => import('websocket-as-promised');

export default async function(
  ws: WebSocketAsPromised,
  url: string,
  debug: WebSocketClient['debug'],
  disconnectCallback: WebSocketClient['disconnectCallback'],
  reconnectCallback: WebSocketClient['reconnectCallback']
) {
  return new WebSocketClient(
    ws,
    url,
    debug,
    disconnectCallback,
    reconnectCallback
  ).connect();
}

export class WebSocketClient implements IPCClient {
  callbacks: { [name: string]: IPCCallback[] } = {};
  debug: import('debug').Debugger;
  disconnectCallback: () => void;
  reconnectCallback: () => void;
  reconnecting?: boolean;
  socket: import('websocket-as-promised');
  url: string;

  constructor(
    ws: WebSocketAsPromised,
    url: string,
    debug: WebSocketClient['debug'],
    disconnectCallback: WebSocketClient['disconnectCallback'],
    reconnectCallback: WebSocketClient['reconnectCallback']
  ) {
    this.url = url;
    this.debug = debug;
    this.disconnectCallback = disconnectCallback;
    this.reconnectCallback = reconnectCallback;
    this.socket = new ws(url, {
      attachRequestId: (data, id) => ({ id, ...data }),
      extractRequestId: data => data && data.id,
      packMessage: data => JSON.stringify(data),
      unpackMessage: message => JSON.parse(message.toString()),
    });
    this.socket.onUnpackedMessage.addListener(message => {
      const { channel, id, payload } = message as IPCData;
      // console.info(`got message on channel ${channel}`, payload);
      // Call registered callbacks
      const callbacks = this.invoke(channel, payload);
      // Make sure we didn't deserialise this message for no reason
      if (id === undefined && callbacks === undefined) {
        throw new Error(`message on channel "${channel}" had no subscriber`);
      }
    });
    this.socket.onClose.addListener(() => {
      if (disconnectCallback) {
        disconnectCallback();
      }
      this.reconnect();
    });
  }

  async connect() {
    // Connect to the editor process first to query it for the Cocoon address
    this.debug(`connecting to "${this.url}"`);
    await this.socket.open();
    return this;
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
    callback?: IPCCallback<ResponseArgs>
  ) {
    const result: IPCData<ResponseArgs> = await this.socket.sendRequest({
      channel,
      payload,
    });
    if (callback) {
      callback(result.payload);
    }
    return result.payload as ResponseArgs;
  }

  registerCallback<CallbackType extends IPCCallback = IPCCallback>(
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

  unregisterCallback(channel: string, callback: IPCCallback) {
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

  private async reconnect() {
    if (!this.reconnecting) {
      this.reconnecting = true;
      try {
        this.debug(`reconnecting`);
        await this.socket.open();
        if (this.reconnectCallback) {
          this.reconnecting = false;
          this.debug(`sucessfully reconnected`);
          this.reconnectCallback();
        }
      } catch (error) {
        this.debug(`connection failed`, error);
        setTimeout(() => {
          this.reconnecting = false;
          this.reconnect();
        }, 500);
      }
    }
  }
}
