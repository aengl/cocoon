import { IPCCallback, IPCContext, IPCServer, PortInfo } from '@cocoon/types';

const channel = 'request-port-data';

export interface Args {
  nodeId: string;
  port: PortInfo;
  sampleSize?: number;
}
export interface Response {
  data?: any;
}

export const onRequestPortData = (
  server: IPCServer,
  callback: IPCCallback<Args, Response>
) => server.registerCallback(channel, callback);

export default (
  context: IPCContext,
  args: Args,
  callback?: IPCCallback<Response>
) => context.cocoon.request<Response>(channel, args, callback);
