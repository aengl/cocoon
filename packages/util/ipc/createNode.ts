import {
  GridPosition,
  IPCCallback,
  IPCContext,
  IPCServer,
} from '@cocoon/types';

const channel = 'create-node';

export interface Args {
  type: string;
  gridPosition?: GridPosition;
  edge?: {
    fromNodeId?: string;
    fromNodePort: string;
    toNodeId?: string;
    toNodePort: string;
  };
}

export const onCreateNode = (server: IPCServer, callback: IPCCallback<Args>) =>
  server.registerCallback(channel, callback);

export default (context: IPCContext, args: Args) =>
  context.cocoon.send(channel, args);
