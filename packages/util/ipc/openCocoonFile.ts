import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'open-cocoon-file';

export interface Args {
  cocoonFilePath: string;
}

export const onOpenCocoonFile = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export const emitOpenCocoonFile = (server: IPCServer, args: Args) =>
  server.emit(channel, args);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
