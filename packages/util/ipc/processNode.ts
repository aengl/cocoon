import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'process-node';

export interface Args {
  nodeId: string;
}

export const onProcessNode = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
