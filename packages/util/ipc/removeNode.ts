import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'remove-node';

export interface Args {
  nodeId: string;
}

export const onRemoveNode = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
