import { execSync } from 'child_process';
import { NodeObject } from '../../../common/node';

/**
 * Runs a terminal command via and reads the result back from stdout.
 */
export const Run: NodeObject = {
  category: 'I/O',

  in: {
    command: {
      hide: true,
      required: true,
    },
    stdin: {
      hide: true,
    },
  },

  out: {
    stdout: {},
  },

  async process(context) {
    const stdin = context.ports.read<string>('stdin');
    const command = context.ports.read<string>('command');
    context.debug(`executing "${command}"`);
    const result = execSync(command, {
      cwd: context.definitions.root,
      input: stdin,
    });
    context.ports.writeAll({ stdout: result.toString() });
  },
};
