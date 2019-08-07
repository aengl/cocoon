import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'run-process';

export interface Args {
  command: string;
  args?: string[];
}

export const onRunProcess = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
