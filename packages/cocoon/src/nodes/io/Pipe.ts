import { CocoonNode } from '@cocoon/types';
import { spawnSync } from 'child_process';

export interface Ports {
  command: string;
  data: object[];
  json?: boolean;
}

export const Pipe: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Pipes an entire collection (optionally encoded as JSON) into a terminal command via stdin, and reads the result back from stdout. The process needs to return the entire collection as either JSON, or split by newlines.`,

  in: {
    command: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
    json: {
      hide: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { command, data, json } = context.ports.read();
    context.debug(`executing "${command}"`);
    const result = spawnSync(command, {
      cwd: context.cocoonFile.root,
      input: json ? JSON.stringify(data) : data.toString(),
    });
    if (result.error) {
      throw result.error;
    }
    context.ports.write({
      data:
        result.stdout.length > 0
          ? json
            ? JSON.parse(result.stdout.toString())
            : result.stdout.toString().split('\n')
          : null,
    });
  },
};
