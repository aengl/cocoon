import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'clear-persisted-cache';

export interface Args {
  nodeId: string;
}

export const onClearPersistedCache = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
