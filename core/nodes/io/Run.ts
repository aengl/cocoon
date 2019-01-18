import { execSync } from 'child_process';
import { NodeObject } from '../../../common/node';
import { resolveDirectory } from '../../fs';

/**
 * Runs a terminal command via and reads the result back from stdout.
 */
export const Run: NodeObject = {
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
      cwd: resolveDirectory(context.definitionsPath),
      input: stdin,
    });
    context.writeToPort('stdout', result.toString());
  },
};
