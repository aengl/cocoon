import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'sync-node';

export interface Args {
  serialisedNode: any;
}

export const onSyncNode = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export const emitSyncNode = (server: IPCServer, args: Args) =>
  server.emit(`${channel}/${args.serialisedNode.id}`, args);

export default {
  register: (
    context: IPCContext,
    nodeId: string,
    callback: IPCCallback<Args>
  ) => context.cocoon.registerCallback(`${channel}/${nodeId}`, callback),
  send: (context: IPCContext, args: Args) => context.cocoon.send(channel, args),
  unregister: (
    context: IPCContext,
    nodeId: string,
    callback: IPCCallback<Args>
  ) => context.cocoon.unregisterCallback(`${channel}/${nodeId}`, callback),
};
