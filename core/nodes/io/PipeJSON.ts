import { spawnSync } from 'child_process';
import { NodeObject } from '../../../common/node';

export interface Ports {
  command: string;
  data: object[];
}

/**
 * Pipes an entire collection (encoded as JSON) into a terminal command via
 * stdin, and reads the result back from stdout. The process needs to return the
 * entire collection as JSON.
 */
export const PipeJSON: NodeObject<Ports> = {
  category: 'I/O',

  in: {
    command: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { command, data } = context.ports.read();
    context.debug(`executing "${command}"`);
    const result = spawnSync(command, {
      cwd: context.definitions.root,
      input: JSON.stringify(data),
    });
    if (result.error) {
      throw result.error;
    }
    context.ports.write({
      data:
        result.stdout.length > 0 ? JSON.parse(result.stdout.toString()) : null,
    });
  },
};
