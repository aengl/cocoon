import { CocoonNode } from '@cocoon/types';
import { execSync } from 'child_process';
import castFunction from '@cocoon/util/castFunction';

type CommandCallback = (item: any) => string;

export interface Ports {
  command: string | CommandCallback;
  data: any[];
  stdio: 'pipe' | 'ignore' | 'inherit';
}

export const Run: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Runs a terminal command, optionally for each data item.`,

  in: {
    command: {
      description: `A terminal command, or a callback that takes a data item and returns the command to execute for the item.`,
      required: true,
      visible: false,
    },
    data: {
      description: `If data is supplied, run the command for each item. The "command" port has to be a callback function returning the command to execute, otherwise the command is only run once.`,
      required: true,
    },
    stdio: {
      description: `If unset, the output is written into the stdout port. This configuration allows configuration of the output pipe via https://nodejs.org/api/child_process.html#child_process_options_stdio`,
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
    const { command, data, stdio } = context.ports.read();
    context.debug(`executing "${command}"`);
    let commandCallback;
    try {
      commandCallback = castFunction(command);
    } catch (error) {
      // Ignore
    }
    if (commandCallback && data) {
      const stdout = data
        .map(item => {
          const cmd = commandCallback(item);
          context.debug(`running "${cmd}"`);
          return execSync(cmd, {
            cwd: context.cocoonFile.root,
            stdio,
          });
        })
        .map(x => (x ? x.toString() : undefined));
      context.ports.write({ data, stdout });
    } else {
      const stdout = execSync(command as string, {
        cwd: context.cocoonFile.root,
        stdio,
      });
      context.ports.write({
        data,
        stdout: stdout ? stdout.toString() : undefined,
      });
    }
  },
};
