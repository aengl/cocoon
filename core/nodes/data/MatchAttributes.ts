import _ from 'lodash';
import { NodeObject } from '../../../common/node';
import { castRegularExpression } from '../../../common/regex';

export interface MatchAttributeDefinitions {
  [attribute: string]: string;
}

/**
 * Transforms attribute values by extracting capture groups from regular
 * expressions.
 */
export const MatchAttributes: NodeObject = {
  category: 'Data',

  in: {
    data: {
      required: true,
    },
    match: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
    nomatch: {},
  },

  async process(context) {
    const data = context.ports.copy<object[]>('data');
    const match = context.ports.read<MatchAttributeDefinitions>('match');
    const results = Object.keys(match).flatMap(attribute => {
      const regexes = _.castArray(match[attribute]).map(expression =>
        castRegularExpression(expression)
      );
      return data.map(item => {
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
            return true;
          }
        }
        return false;
      });
    });
    context.ports.writeAll({
      data,
      nomatch: data.filter((d, i) => results[i] === false),
    });
    const numMatches = results.filter(x => Boolean(x)).length;
    return `Found ${numMatches} matches for ${
      Object.keys(match).length
    } attributes in ${data.length} items`;
  },
};
