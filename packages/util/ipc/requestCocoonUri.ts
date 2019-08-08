import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'request-cocoon-uri';

export interface Response {
  uri?: string;
}

export const onRequestCocoonUri = (
  server: IPCServer,
  callback: IPCCallback<null, Response>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, callback?: IPCCallback<Response>) =>
  context.editor.request<Response>(channel, callback);
