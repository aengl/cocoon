import { CocoonNode } from '@cocoon/types';
import { execSync } from 'child_process';
import castFunction from '@cocoon/util/castFunction';

type CommandCallback = (item: any) => string;

export interface Ports {
  command: string | CommandCallback;
  data: any[];
}

export const Run: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Runs a terminal command for each data item.`,

  in: {
    command: {
      description: `A callback that takes a data item and returns the command to execute for the item.`,
      hide: true,
      required: true,
    },
    data: {
      description: `If data is supplied, run the command for each item. The "command" port will be interpreted as a callback function returning the command to execute.`,
      required: true,
    },
  },

  out: {
    data: {
      description: `The original data.`,
    },
    stdout: {
      description: `A list of command outputs (standard out).`,
    },
  },

  async *process(context) {
    const { command, data } = context.ports.read();
    const commandCallback = castFunction(command);
    context.debug(`executing "${command}"`);
    const stdout = data.map(item => {
      const cmd = commandCallback(item);
      context.debug(`running "${cmd}"`);
      return execSync(cmd, {
        cwd: context.cocoonFile.root,
      }).toString();
    });
    context.ports.write({ data, stdout });
  },
};
