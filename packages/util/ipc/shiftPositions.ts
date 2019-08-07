import { IPCCallback, IPCContext, IPCServer } from '@cocoon/types';

const channel = 'shift-positions';

export interface Args {
  beforeRow?: number;
  beforeColumn?: number;
  shiftBy: number;
}

export const onShiftPositions = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
