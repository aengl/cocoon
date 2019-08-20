import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'invalidate-node-cache';

export interface Args {
  nodeId?: string;
  downstream?: boolean;
}

export const onInvalidateNodeCache = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, args?: Args) =>
  context.cocoon.send(channel, args);
