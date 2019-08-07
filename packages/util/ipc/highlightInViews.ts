import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'highlight-in-views';

export interface Args {
  data: any;
  senderNodeId: string;
}

export const onHighlightInViews = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export const emitHighlightInViews = (server: IPCServer, args: Args) =>
  server.emit(channel, args);

export default {
  register: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.registerCallback(channel, callback),
  send: (context: IPCContext, args: Args) => context.cocoon.send(channel, args),
  unregister: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.cocoon.unregisterCallback(channel, callback),
};
