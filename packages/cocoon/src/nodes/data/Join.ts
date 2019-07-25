import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  affluent: object[];
  annotate?: object;
  attribute?: string;
  data: object[];
  key: string | [string, string];
}

export const Join: CocoonNode<Ports> = {
  category: 'Data',
  description: 'Joins two collections via a primary key.',

  in: {
    affluent: {
      description: `The collection to merge into the source data.`,
      required: true,
    },
    annotate: {
      description: `Merge additional data into successfully joined items.`,
    },
    attribute: {
      description: `If defined, put the joined data into a new attribute in the source data.`,
      visible: false,
    },
    data: {
      description: `The source data that is joined into.`,
      required: true,
    },
    key: {
      description: `One or more keys to join the two collections with.`,
      required: true,
      visible: false,
    },
  },

  out: {
    data: {
      description: `The joined data.`,
    },

    unmatched: {
      description: `Data (not affluent data!) that was not matched during the join.`,
    },
  },

  async *process(context) {
    const { affluent, annotate, attribute, data, key } = context.ports.read();
    const affluentKey = _.isArray(key) ? key[1] : key;
    const dataKey = _.isArray(key) ? key[0] : key;
    const shallowDataCopy = [...data];
    const unmatched: Ports['data'] = [];

    let numJoined = 0;
    for (let i = 0; i < data.length; i++) {
      let joined = false;
      for (let j = 0; j < affluent.length; j++) {
        if (
          !_.isNil(data[i][dataKey]) &&
          !_.isNil(affluent[j][affluentKey]) &&
          data[i][dataKey] === affluent[j][affluentKey]
        ) {
          shallowDataCopy[i] = {
            ...data[i],
            ...(attribute ? { [attribute]: affluent[j] } : affluent[j]),
            ...annotate,
          };
          joined = true;
          break;
        }
      }
      if (joined) {
        numJoined += 1;
      } else {
        unmatched.push(data[i]);
      }
      yield [`Found ${numJoined} matches`, i / data.length];
    }

    context.ports.write({
      data: shallowDataCopy,
      unmatched,
    });
    return `Found ${numJoined} matches`;
  },
};
