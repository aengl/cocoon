import _ from 'lodash';
import { NodeObject } from '../../../common/node';
import { castRegularExpression } from '../../../common/regex';

export interface MatchAttributeDefinitions {
  [attribute: string]: string;
}

export const MatchAttributes: NodeObject = {
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
      const regexes = _.castArray(match[attribute]).map(expression =>
        castRegularExpression(expression)
      );
      data.forEach(item => {
        if (item[attribute] !== undefined) {
          const regexMatch = regexes
            .map(regex => (item[attribute] as string).match(regex))
            .find(m => m !== null);
          if (regexMatch) {
            if (regexMatch.groups !== undefined) {
              _.assign(item, regexMatch.groups);
            } else {
              item[attribute] = regexMatch[1].trim();
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
