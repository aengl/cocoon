import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isObject, merge } from '../lodash-lite.ts';
import type { CocoonProcessNode } from '../contract.ts';

interface AnnotationData {
  [key: string]: Record<string, unknown>;
}

/**
 * Port of legacy `@cocoon/cocoon` io/Annotate (the boardgames flow's
 * `bgg_annotations.json` merge). lodash shed to `../lodash-lite.ts`
 * (`merge`/`isObject`); legacy `resolveFilePath` → cocoon-dir-relative
 * resolution like the other I/O nodes.
 *
 * The legacy `receive`/`writeAnnotationData` write-back (the annotation
 * editor view persisting edits back into the JSON) is intentionally **not**
 * ported yet — it is a view-driven action and views are deferred in the
 * prototype; `process` (read + merge) is all the flow needs to run.
 */
export const Annotate: CocoonProcessNode = {
  category: 'I/O',
  description: `Merges annotations stored in a JSON file into the data.`,

  async *process(context) {
    const { debug } = context;
    const { data, key } = context.ports.read() as {
      data: Record<string, string>[];
      key: string;
      path: string;
    };
    const annotations = await readAnnotationData(context);

    // Faithful legacy port: a bare map. Multi-edge concatenation is the
    // port-read layer's job (resolveInputs ⇄ legacy graph.ts#getPortData),
    // never the node's.
    let numAnnotated = 0;
    const annotatedData = data.map(item => {
      if (!(key in item)) {
        debug(`error: no key in item`, item);
        throw new Error(`one ore more items are lacking a key attribute`);
      }
      const annotation = annotations[item[key]];
      if (annotation) {
        numAnnotated += 1;
        return merge(item, annotation);
      }
      return item;
    });

    context.ports.write({
      annotations,
      data: annotatedData,
    });
    return `Annotated ${numAnnotated} items`;
  },
};

async function readAnnotationData(context: {
  ports: { read(): Record<string, unknown> };
  debug(...args: unknown[]): void;
  cocoonFilePath: string;
}): Promise<AnnotationData> {
  const { path: filePath } = context.ports.read() as { path: string };
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(path.dirname(context.cocoonFilePath), filePath);
  context.debug(`reading annotations from "${resolvedPath}"`);
  try {
    const data = JSON.parse(
      await fs.readFile(resolvedPath, { encoding: 'utf8' })
    ) as AnnotationData;
    if (!isObject(data)) {
      context.debug(`annotation file contains invalid data`);
      return {};
    }
    return data;
  } catch (error) {
    context.debug(`error reading annotation file:`, error);
    return {};
  }
}
