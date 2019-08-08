import { IPCCallback, IPCContext, IPCServer, PortInfo } from '@cocoon/types';

const channel = 'create-view';

export interface Args {
  type: string;
  nodeId: string;
  port?: PortInfo;
}

export const onCreateView = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
