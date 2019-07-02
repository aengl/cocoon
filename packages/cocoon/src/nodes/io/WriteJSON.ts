import { CocoonNode } from '@cocoon/types';
import fs from 'fs';
import stringify from 'json-stable-stringify';

export interface Ports {
  data: object[];
  path: string;
  pretty: boolean;
  stable: boolean;
}

export const WriteJSON: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Writes a collection to a JSON file.`,

  in: {
    data: {
      required: true,
    },
    path: {
      defaultValue: 'data.json',
      hide: true,
    },
    pretty: {
      defaultValue: false,
      hide: true,
    },
    stable: {
      defaultValue: false,
      hide: true,
    },
  },

  async process(context) {
    const { data, path: filePath, pretty, stable } = context.ports.read();
    const json = pretty
      ? stable
        ? stringify(data, { space: 2 })
        : JSON.stringify(data, undefined, 2)
      : JSON.stringify(data);
    await fs.promises.writeFile(filePath, json);
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
