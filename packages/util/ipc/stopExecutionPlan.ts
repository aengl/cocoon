import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'stop-execution-plan';

export const onStopExecutionPlan = (server: IPCServer, callback: IPCCallback) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext) => context.cocoon.send(channel);
