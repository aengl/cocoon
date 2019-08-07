import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'error';

export interface Args {
  error: {
    name?: string;
    stack?: string;
    message?: string;
    code?: string;
  } | null;
}

export const emitError = (server: IPCServer, args: Args) =>
  server.emit(channel, args);

export default {
  register: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.registerCallback(channel, callback),
  unregister: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.unregisterCallback(channel, callback),
};
