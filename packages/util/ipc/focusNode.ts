import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'focus-node';

export interface Args {
  nodeId: string;
}

export const onFocusNode = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export const emitFocusNode = (server: IPCServer, args: Args) =>
  server.emit(channel, args);

export default {
  register: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.registerCallback(channel, callback),
  send: (context: IPCContext, args: Args) => context.cocoon.send(channel, args),
  unregister: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.unregisterCallback(channel, callback),
};
