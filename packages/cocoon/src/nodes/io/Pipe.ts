import { CocoonNode } from '@cocoon/types';
import castFunction from '@cocoon/util/castFunction';
import { spawnSync } from 'child_process';

export interface Ports {
  command: string;
  data: Record<string, unknown>[];
  serialise?: string | ((x: any) => any);
  deserialise?: string | ((x: any) => any);
}

export const Pipe: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Pipes an entire collection into a terminal command via stdin, and reads the result back from stdout.`,

  in: {
    command: {
      description: `The shell command to execute.`,
      required: true,
      visible: false,
    },
    data: {
      description: `The data that is piped into the command via stdin.`,
    },
    deserialise: {
      description: `A function that deserialises the data that is read back from stdout. If unspecified, it will be a string.`,
      visible: false,
    },
    serialise: {
      description: `A function that serialises the data that is piped into the process via stdin. If unspecified, \`toString()\` will be called on the data object.`,
      visible: false,
    },
  },

  out: {
    data: {
      description: `The data read back from stdout.`,
    },
  },

  async *process(context) {
    const { command, data, deserialise, serialise } = context.ports.read();
    context.debug(`executing "${command}"`);
    const result = spawnSync(command, {
      cwd: context.cocoonFile.root,
      input: data
        ? serialise
          ? castFunction(serialise)(data)
          : data.toString()
        : undefined,
      shell: true,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `process returned with status ${result.status}

${result.stderr.toString()}`
      );
    }
    context.ports.write({
      data:
        result.stdout.length > 0
          ? deserialise
            ? castFunction(deserialise)(result.stdout.toString())
            : result.stdout.toString()
          : null,
    });
  },
};
