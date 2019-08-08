import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'update-node-progress';

export interface Args {
  summary?: string | null;
  percent?: number | null;
}

export const emitUpdateNodeProgress = (
  server: IPCServer,
  nodeId: string,
  args: Args
) => server.emit(`${channel}/${nodeId}`, args);

export default {
  register: (
    context: IPCContext,
    nodeId: string,
    callback: IPCCallback<Args>
  ) => context.cocoon.registerCallback(`${channel}/${nodeId}`, callback),
  unregister: (
    context: IPCContext,
    nodeId: string,
    callback: IPCCallback<Args>
  ) => context.cocoon.unregisterCallback(`${channel}/${nodeId}`, callback),
};
