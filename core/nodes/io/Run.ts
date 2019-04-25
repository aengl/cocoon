import { execSync } from 'child_process';
import { NodeObject } from '../../../common/node';

export interface Ports {
  command: string;
  stdin: string;
}

export const Run: NodeObject<Ports> = {
  category: 'I/O',
  description: `Runs a terminal command via and reads the result back from stdout.`,

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
    const { command, stdin } = context.ports.read();
    context.debug(`executing "${command}"`);
    const result = execSync(command, {
      cwd: context.definitions.root,
      input: stdin,
    });
    context.ports.write({ stdout: result.toString() });
  },
};
