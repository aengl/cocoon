import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pick, stableStringify } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Port of legacy `@cocoon/cocoon` io/WriteJSON. lodash shed to
 * `../lodash-lite.ts` (`pick`); the `json-stable-stringify` dep replaced by a
 * faithful default `stableStringify` (sorted keys, recursive). Legacy wrote a
 * raw cwd-relative path; like `ReadJSON`/`Download` the prototype resolves it
 * against the cocoon file's directory so the graph runs regardless of cwd
 * (the legacy flow always ran with cwd = the cocoon dir, so behaviour holds).
 */
export const WriteJSON: CocoonProcessNode = {
  category: 'I/O',
  description: `Writes a collection to a JSON file.`,

  async *process(context) {
    const {
      attributes,
      data,
      path: filePath,
      pretty,
      stable,
    } = context.ports.read() as {
      attributes?: string[];
      data: Record<string, unknown>[];
      path: string;
      pretty?: boolean;
      stable?: boolean;
    };
    const cleanedData = attributes
      ? data.map(x => pick(x, attributes))
      : data;
    const json = pretty
      ? stable
        ? stableStringify(cleanedData, 2)
        : JSON.stringify(cleanedData, undefined, 2)
      : JSON.stringify(cleanedData);
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(path.dirname(context.cocoonFilePath), filePath);
    await fs.writeFile(abs, json);
    return data.length
      ? `Exported ${data.length} items`
      : `Exported "${filePath}"`;
  },
};
