import { spawnSync } from 'child_process';
import { NodeObject } from '../../../common/node';

/**
 * Pipes an entire collection (encoded as JSON) into a terminal command via
 * stdin, and reads the result back from stdout. The process needs to return the
 * entire collection as JSON.
 */
export const PipeJSON: NodeObject = {
  category: 'I/O',

  in: {
    command: {
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
    const data = context.readFromPort<object[]>('data');
    const command = context.readFromPort<string>('command');
    context.debug(`executing "${command}"`);
    const result = spawnSync(command, {
      cwd: context.definitions.root,
      input: JSON.stringify(data),
    });
    if (result.error) {
      throw result.error;
    }
    context.writeToPort(
      'data',
      result.stdout.length > 0 ? JSON.parse(result.stdout.toString()) : null
    );
  },
};
