import { castRegularExpression } from '@cocoon/shared/cast';
import { CocoonNode } from '@cocoon/types';
import _ from 'lodash';

export interface Ports {
  data: object[];
  match: MatchAttributeDefinitions;
}

export interface MatchAttributeDefinitions {
  [attribute: string]: string;
}

export const MatchAttributes: CocoonNode<Ports> = {
  category: 'Data',
  description: `Transforms attribute values by extracting capture groups from regular expressions.`,

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
    const ports = context.ports.read();
    const data = context.ports.copy(ports.data);
    const results = Object.keys(ports.match).flatMap(attribute => {
      const regexes = _.castArray(ports.match[attribute]).map(expression =>
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
    context.ports.write({
      data,
      nomatch: data.filter((d, i) => results[i] === false),
    });
    const numMatches = results.filter(x => Boolean(x)).length;
    return `Found ${numMatches} matches for ${
      Object.keys(ports.match).length
    } attributes in ${data.length} items`;
  },
};
