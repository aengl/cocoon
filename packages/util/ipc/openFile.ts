import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'open-file';

export interface Args {
  uri: string;
}

export const onOpenFile = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
