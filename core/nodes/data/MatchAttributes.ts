import _ from 'lodash';
import { NodeObject } from '../../../common/node';
import { castRegularExpression } from '../../../common/regex';

export interface MatchAttributeDefinitions {
  [attribute: string]: string;
}

const MatchAttributes: NodeObject = {
  in: {
    data: {
      required: true,
    },
    match: {
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const data = context.cloneFromPort<object[]>('data');
    const match = context.readFromPort<MatchAttributeDefinitions>('match');
    Object.keys(match).forEach(attribute => {
      const regex = castRegularExpression(match[attribute]);
      data.forEach(item => {
        if (item[attribute] !== undefined) {
          const value: string = item[attribute];
          const m = value.match(regex);
          if (m !== null) {
            if (m.groups !== undefined) {
              _.assign(item, m.groups);
            } else {
              item[attribute] = m[1].trim();
            }
          }
        }
      });
    });
    context.writeToPort<object[]>('data', data);
    return `Matched ${Object.keys(match).length} attributes in ${
      data.length
    } items`;
  },
};

export { MatchAttributes };
