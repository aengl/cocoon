import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'create-edge';

export interface Args {
  fromNodeId: string;
  fromNodePort: string;
  toNodeId: string;
  toNodePort: string;
}

export const onCreateEdge = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
