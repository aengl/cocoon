import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'send-to-node';

export interface Args {
  nodeId: string;
  data: any;
}

export const onSendToNode = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
