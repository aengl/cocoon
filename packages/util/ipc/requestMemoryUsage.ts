import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'request-memory-usage';

export interface Response {
  memoryUsage: NodeJS.MemoryUsage;
}

export const onRequestMemoryUsage = (
  server: IPCServer,
  callback: IPCCallback<null, Response>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, callback?: IPCCallback<Response>) =>
  context.cocoon.request<Response>(channel, null, callback);
