import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'request-node-view-data';

export interface Args {
  nodeId: string;
}
export interface Response {
  viewData: any;
}

export const onRequestNodeViewData = (
  server: IPCServer,
  callback: IPCCallback<Args, Response>
) => server.registerCallback(channel, callback);

export default (
  context: IPCContext,
  args: Args,
  callback?: IPCCallback<Response>
) => context.cocoon.request<Response>(channel, args, callback);
