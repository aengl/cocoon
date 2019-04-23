import { NodeObject } from '../../../common/node';

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

export const Annotate: NodeObject<Ports> = {
  category: 'I/O',
  description: `Merges annotations stored in a JSON file into the data.`,

  in: {
    data: {
      description: `The data to be annotated.`,
      required: true,
    },
    key: {
      defaultValue: '_id',
      description: `The primary key used for joining the annotated data.`,
      hide: true,
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
    const { fs } = context;
    const { data, key, path: filePath } = context.ports.read();
    const annotationData: AnnotationData = await fs.parseJsonFile(filePath, {
      root: context.definitions.root,
    });

    let numAnnotated = 0;
    const annotatedData = data.map(item => {
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
};
