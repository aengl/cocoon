import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'log';

export interface Args {
  additionalArgs: any[];
  color: string;
  namespace: string;
  message: string;
}

export const emitLog = (server: IPCServer, args: Args) =>
  server.emit(channel, args);

export default {
  register: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.registerCallback(channel, callback),
  unregister: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.unregisterCallback(channel, callback),
};
