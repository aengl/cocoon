import { CocoonNode } from '@cocoon/types';
import { execSync } from 'child_process';

export interface Ports {
  command: string;
  stdin: string;
}

export const Run: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Runs a terminal command and reads the result back from stdout.`,

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
      cwd: context.cocoonFile.root,
      input: stdin,
    });
    context.ports.write({ stdout: result.toString() });
  },
};
