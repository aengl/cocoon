import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'request-node-view';

export interface Args {
  nodeId: string;
  query: any;
}
export interface Response {
  data?: any;
}

export const onRequestNodeView = (
  server: IPCServer,
  callback: IPCCallback<Args, Response>
) => server.registerCallback(channel, callback);

export default (
  context: IPCContext,
  args: Args,
  callback?: IPCCallback<Response>
) => context.cocoon.request<Response>(channel, args, callback);
