import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'request-node-sync';

export interface Args {
  nodeId: string;
  syncId?: number;
}
export interface Response {
  serialisedNode: any;
}

export const onRequestNodeSync = (
  server: IPCServer,
  callback: IPCCallback<Args, Response>
) => server.registerCallback(channel, callback);

export default (
  context: IPCContext,
  args: Args,
  callback?: IPCCallback<Response>
) => context.cocoon.request<Response>(channel, args, callback);
