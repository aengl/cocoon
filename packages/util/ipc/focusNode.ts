import { IPCCallback, IPCContext } from '@cocoon/types';

const channel = 'focus-node';

export interface Args {
  nodeId: string;
}

export default {
  register: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.editor.registerCallback(channel, callback),
  send: (context: IPCContext, args: Args) =>
    context.editor.invoke(channel, args),
  unregister: (context: IPCContext, callback: IPCCallback<Args>) =>
    context.editor.unregisterCallback(channel, callback),
};
