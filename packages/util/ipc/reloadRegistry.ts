import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'reload-registry';

export const onReloadRegistry = (server: IPCServer, callback: IPCCallback) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext) => context.cocoon.send(channel);
