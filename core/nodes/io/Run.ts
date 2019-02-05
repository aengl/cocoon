import { execSync } from 'child_process';
import { NodeObject } from '../../../common/node';

/**
 * Runs a terminal command via and reads the result back from stdout.
 */
export const Run: NodeObject = {
  category: 'I/O',

  in: {
    command: {
      required: true,
    },
    stdin: {},
  },

  out: {
    stdout: {},
  },

  async process(context) {
    const stdin = context.readFromPort<string>('stdin');
    const command = context.readFromPort<string>('command');
    context.debug(`executing "${command}"`);
    const result = execSync(command, {
      cwd: context.definitions.root,
      input: stdin,
    });
    context.writeToPort('stdout', result.toString());
  },
};
