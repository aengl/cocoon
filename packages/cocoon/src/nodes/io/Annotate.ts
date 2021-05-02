import { CocoonNode, CocoonNodeContext } from '@cocoon/types';
import resolveFilePath from '@cocoon/util/resolveFilePath';
import fs from 'fs';
import _ from 'lodash';

interface AnnotationData {
  [key: string]: Record<string, unknown>;
}

export interface Ports {
  data: Record<string, string>[];
  key: string;
  path: string;
}

export const Annotate: CocoonNode<Ports> = {
  category: 'I/O',
  description: `Merges annotations stored in a JSON file into the data.`,

  in: {
    data: {
      description: `The data to be annotated.`,
      required: true,
    },
    key: {
      description: `The primary key used for joining the annotated data.`,
      required: true,
      visible: false,
    },
    path: {
      description: `Path to the JSON file containing the annotations.`,
      required: true,
      visible: false,
    },
  },

  out: {
    annotations: {
      description: `The imported annotations only.`,
    },
    data: {
      description: `The input data with annotations.`,
    },
  },

  async *process(context) {
    const { debug } = context;
    const { data, key } = context.ports.read();
    const annotations = await readAnnotationData(context);

    let numAnnotated = 0;
    const annotatedData = data.map(item => {
      if (!(key in item)) {
        debug(`error: no key in item`, item);
        throw new Error(`one ore more items are lacking a key attribute`);
      }
      const annotation = annotations[item[key]];
      if (annotation) {
        numAnnotated += 1;
        return _.merge(item, annotation);
      }
      return item;
    });

    context.ports.write({
      annotations,
      data: annotatedData,
    });
    return `Annotated ${numAnnotated} items`;
  },

  async receive(context, data: any) {
    const { debug } = context;
    const { key } = context.ports.read();
    if (!(key in data)) {
      debug(`error: no key in data`, data);
      throw new Error(`data is lacking the key attribute "${key}"`);
    }
    const annotationData = await readAnnotationData(context);
    annotationData[data[key]] = {
      ..._.omit(data, key),
      $last_annotated: new Date().toISOString(),
    };
    await writeAnnotationData(context, annotationData);
    context.invalidate();
  },
};

async function readAnnotationData(context: CocoonNodeContext<Ports>) {
  const { path: filePath } = context.ports.read();
  const resolvedPath = resolveFilePath(filePath);
  context.debug(`reading annotations from "${resolvedPath}"`);
  try {
    const data = JSON.parse(
      await fs.promises.readFile(resolvedPath, { encoding: 'utf8' })
    ) as AnnotationData;
    if (!_.isObject(data)) {
      context.debug(`annotation file contains invalid data`);
      return {};
    }
    return data;
  } catch (error) {
    context.debug(`error reading annotation file:`, error);
    return {};
  }
}

async function writeAnnotationData(
  context: CocoonNodeContext<Ports>,
  data: AnnotationData
) {
  const { path: filePath } = context.ports.read();
  const resolvedPath = resolveFilePath(filePath);
  await fs.promises.writeFile(resolvedPath, JSON.stringify(data, undefined, 2));
}
