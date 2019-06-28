import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

interface AnnotationData {
  _id: {
    [key: string]: any;
  };
}

export interface Ports {
  data: object[];
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
      hide: true,
      required: true,
    },
    path: {
      description: `Path to the JSON file containing the annotations.`,
      hide: true,
      required: true,
    },
  },

  out: {
    data: {
      description: `The input data with annotations.`,
    },
  },

  async process(context) {
    const { debug, fs } = context;
    const { data, key, path: filePath } = context.ports.read();
    const annotationData: AnnotationData = await fs.parseJsonFile(filePath, {
      root: context.definitions.root,
    });

    let numAnnotated = 0;
    const annotatedData = data.map(item => {
      if (!(key in item)) {
        debug(`error: no key in item`, item);
        throw new Error(`one ore more items are lacking a key attribute`);
      }
      const annotation = annotationData[item[key]];
      if (annotation) {
        numAnnotated += 1;
        return { ...item, ...annotation };
      }
      return item;
    });

    context.ports.write({ data: annotatedData });
    return `Annotated ${numAnnotated} items`;
  },

  async receive(context, data: any) {
    const { debug, fs } = context;
    const { key, path: filePath } = context.ports.read();
    if (!(key in data)) {
      debug(`error: no key in data`, data);
      throw new Error(`data is lacking the key attribute`);
    }
    const resolvedPath = fs.findPath(filePath, {
      root: context.definitions.root,
    });
    const annotationData: AnnotationData = await fs.parseJsonFile(resolvedPath);
    annotationData[data[key]] = {
      $last_annotated: new Date().toISOString(),
      ..._.omit(data, key),
    };
    await fs.writePrettyJsonFile(resolvedPath, annotationData);
    context.invalidate();
  },
};