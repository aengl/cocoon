import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'purge-cache';

export const onPurgeCache = (server: IPCServer, callback: IPCCallback) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext) => context.cocoon.send(channel);
