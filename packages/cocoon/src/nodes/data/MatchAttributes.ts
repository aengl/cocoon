import { CocoonNode } from '@cocoon/types';
import castRegularExpression from '@cocoon/util/castRegularExpression';
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
  description: `Modifies or creates attributes by extracting capture groups from regular expressions.`,

  in: {
    data: {
      clone: true,
      description: `The data to modify.`,
      required: true,
    },
    match: {
      description: `Maps a data attribute to one or more regular expressions. Each expression will assign their captured values back to the attribute or an attribute targeted by the name of the respective capture group.`,
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
    match: {},
    nomatch: {},
  },

  async *process(context) {
    const { data, match } = context.ports.read();
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
    context.ports.write({
      data,
      match: data.filter((d, i) => results[i] === true),
      nomatch: data.filter((d, i) => results[i] === false),
    });
    const numMatches = results.filter(x => Boolean(x)).length;
    return `Found ${numMatches} matches for ${
      Object.keys(match).length
    } attributes in ${data.length} items`;
  },
};
