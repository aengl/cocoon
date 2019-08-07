import { IPCContext, WebsocketCallback } from '@cocoon/types';

const channel = 'request-cocoon-uri';

export interface RequestCocoonUriResponseArgs {
  uri?: string;
}

export const onRequestCocoonUri = (
  server: import('./createServer').WebSocketServer,
  callback: WebsocketCallback<null, RequestCocoonUriResponseArgs>
) => server.registerCallback(channel, callback);

export default (context: IPCContext) =>
  context.editor.request<RequestCocoonUriResponseArgs>(channel);
