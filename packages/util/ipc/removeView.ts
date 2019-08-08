import { IPCCallback, IPCContext, IPCServer, PortInfo } from '@cocoon/types';

const channel = 'remove-view';

export interface Args {
  nodeId: string;
}

export const onRemoveView = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
