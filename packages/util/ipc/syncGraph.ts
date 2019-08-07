import {
  CocoonRegistry,
  IPCCallback,
  IPCContext,
  IPCServer,
} from '@cocoon/types';

const channel = 'sync-graph';

export interface SyncGraphArgs {
  registry: CocoonRegistry;
  serialisedGraph: any;
}

export const onSyncGraph = (
  server: IPCServer,
  callback: IPCCallback<null, SyncGraphArgs>
) => server.registerCallback(channel, callback);

export const emitSyncGraph = (server: IPCServer, args: SyncGraphArgs) =>
  server.emit(channel, args);

export default {
  register: (context: IPCContext, callback: IPCCallback<SyncGraphArgs>) =>
    context.cocoon.registerCallback(channel, callback),
  unregister: (context: IPCContext, callback: IPCCallback<SyncGraphArgs>) =>
    context.cocoon.unregisterCallback(channel, callback),
};
