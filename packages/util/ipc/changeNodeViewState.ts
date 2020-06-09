import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'change-node-view-state';

export interface Args {
  nodeId: string;
  viewState: Record<string, unknown>;
}

export const onChangeNodeViewState = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
