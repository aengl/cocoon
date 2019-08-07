import {
  CocoonRegistry,
  IPCCallback,
  IPCContext,
  IPCServer,
} from '@cocoon/types';

const channel = 'request-registry';

export interface Response {
  registry: CocoonRegistry;
}

export const onRequestRegistry = (
  server: IPCServer,
  callback: IPCCallback<null, Response>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, callback?: IPCCallback<Response>) =>
  context.cocoon.request<Response>(channel, null, callback);
