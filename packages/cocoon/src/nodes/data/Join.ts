import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  affluent: Record<string, unknown>[];
  annotate?: Record<string, unknown>;
  attribute?: string;
  data: Record<string, unknown>[];
  key: string | [string, string];
  preserve?: boolean;
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
    preserve: {
      defaultValue: false,
      description: `If true, affluent keys with the same value preserve the original data key.`,
      visible: false,
    },
  },

  out: {
    data: {
      description: `The joined data.`,
    },

    matched: {
      description: `Contains only the matched data.`,
    },

    unmatched: {
      description: `Data (not affluent data!) that was not matched during the join.`,
    },
  },

  async *process(context) {
    const {
      affluent,
      annotate,
      attribute,
      data,
      key,
      preserve,
    } = context.ports.read();
    const affluentKey = _.isArray(key) ? key[1] : key;
    const dataKey = _.isArray(key) ? key[0] : key;
    const shallowDataCopy = [...data];
    const matched: Ports['data'] = [];
    const unmatched: Ports['data'] = [];

    // Create lookup map for affluent data
    const affluentLookup = new Map<string, string>();
    affluent.forEach(x => {
      const v = _.get(x, affluentKey) as string;
      if (v) {
        affluentLookup[v] = x;
      }
    });

    // Join data
    let numJoined = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 1000 === 0) {
        yield [`Found ${numJoined} matches`, i / data.length];
      }
      const dataKeyValue = _.get(data[i], dataKey) as string | undefined;
      if (_.isNil(dataKeyValue)) {
        unmatched.push(data[i]);
        continue;
      }
      const affluentKeyValue = affluentLookup[dataKeyValue];
      if (_.isNil(affluentKeyValue)) {
        unmatched.push(data[i]);
        continue;
      }
      if (preserve) {
        shallowDataCopy[i] = {
          ...(attribute ? { [attribute]: affluentKeyValue } : affluentKeyValue),
          ...data[i],
          ...annotate,
        };
      } else {
        shallowDataCopy[i] = {
          ...data[i],
          ...(attribute ? { [attribute]: affluentKeyValue } : affluentKeyValue),
          ...annotate,
        };
      }
      numJoined += 1;
      matched.push(data[i]);
    }

    context.ports.write({
      data: shallowDataCopy,
      matched,
      unmatched,
    });
    return `Found ${numJoined} matches`;
  },
};
