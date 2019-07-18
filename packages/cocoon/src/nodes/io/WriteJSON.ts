import { CocoonNode } from '@cocoon/types';
import fs from 'fs';
import stringify from 'json-stable-stringify';
import _ from 'lodash';

export interface Ports {
  attributes?: string[];
  data: object[];
  path: string;
  pretty?: boolean;
  stable: boolean;
}

export const WriteJSON: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Writes a collection to a JSON file.`,

  in: {
    attributes: {
      description: `Only serialise the listed attributes.`,
      hide: true,
    },
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

  async *process(context) {
    const {
      attributes,
      data,
      path: filePath,
      pretty,
      stable,
    } = context.ports.read();
    const cleanedData = attributes
      ? data.map(x => _.pick(x, attributes))
      : data;
    const json = pretty
      ? stable
        ? stringify(cleanedData, { space: 2 })
        : JSON.stringify(cleanedData, undefined, 2)
      : JSON.stringify(cleanedData);
    await fs.promises.writeFile(filePath, json);
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
