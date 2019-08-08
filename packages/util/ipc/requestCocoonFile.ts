import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'request-cocoon-file';

export interface Response {
  contents?: string;
}

export const onRequestCocoonFile = (
  server: IPCServer,
  callback: IPCCallback<null, Response>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, callback?: IPCCallback<Response>) =>
  context.cocoon.request(channel, null, callback);
