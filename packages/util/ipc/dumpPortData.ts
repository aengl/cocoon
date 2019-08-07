import { IPCCallback, IPCContext, IPCServer, PortInfo } from '@cocoon/types';

const channel = 'dump-port-data';

export interface Args {
  nodeId: string;
  port: PortInfo;
}

export const onDumpPortData = (
  server: IPCServer,
  callback: IPCCallback<Args>
) => server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
