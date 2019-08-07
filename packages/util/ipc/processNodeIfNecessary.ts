import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'process-node-if-necessary';

export interface Args {
  nodeId: string;
}

export const onProcessNodeIfNecessary = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
