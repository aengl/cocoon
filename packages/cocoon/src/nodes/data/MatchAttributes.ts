import { CocoonNode } from '@cocoon/types';
import castRegularExpression from '@cocoon/util/castRegularExpression';
import _ from 'lodash';

type MatchResult = [object, boolean, string, Array<RegExpMatchArray | null>];

export interface Ports {
  data: object[];
  match: MatchAttributeDefinitions;
}

export interface MatchAttributeDefinitions {
  [attribute: string]: string | RegExp | string[] | RegExp[];
}

export const MatchAttributes: CocoonNode<Ports> = {
  category: 'Data',
  description: `Matches, modifies or creates attributes by extracting capture groups from regular expressions.`,

  in: {
    data: {
      description: `The data to modify.`,
      required: true,
    },
    match: {
      description: `Maps a data attribute to one or more regular expressions. If the regular expression contains capture groups, each expression will assign their captured values back to the attribute or an attribute targeted by the name of the respective capture group.`,
      hide: true,
      required: true,
    },
  },

  out: {
    data: {
      description: `The modified data.`,
    },
    matched: {
      description: `The modified data, but filtered to contain only items that were matched.`,
    },
    matches: {
      description: `Shows all matches -- for debugging.`,
    },
    unmatched: {
      description: `The modified data, but filtered to contain only items that were not matched.`,
    },
  },

  async *process(context) {
    const { data, match } = context.ports.read();
    const regexes = _.mapValues(match, x =>
      _.castArray<string | RegExp>(x).map(expression =>
        castRegularExpression(expression)
      )
    );
    const results = data.map(item =>
      Object.keys(regexes).reduce(
        (acc, attribute) => {
          const m = findMatches(acc[0], attribute, regexes[attribute]);
          return [m[0], acc[1] || m[1], attribute, [...acc[3], ...m[3]]];
        },
        [item, false, '', []] as MatchResult
      )
    );
    context.ports.write({
      data: results.map(x => x[0]),
      matched: results.filter(x => x[1]).map(x => x[0]),
      matches: results.reduce((acc, x) => {
        if (!(x[2] in acc)) {
          acc[x[2]] = [];
        }
        acc[x[2]].push([x[1], x[0][x[2]], x[3]]);
        return acc;
      }, {}),
      unmatched: results.filter(x => !x[1]).map(x => x[0]),
    });
    const numMatches = results.filter(x => Boolean(x)).length;
    return `Found ${numMatches} matches for ${
      Object.keys(match).length
    } attributes in ${data.length} items`;
  },
};

function findMatches(
  item: object,
  attribute: string,
  regexes: RegExp[]
): MatchResult {
  const value: string | null | undefined = item[attribute];
  if (_.isNil(value)) {
    return [item, false, attribute, []];
  }
  const matches = regexes.map(regex => value.match(regex));
  const firstMatch = matches.find(x => x !== null);
  return firstMatch && firstMatch.groups !== undefined
    ? // Assign named capture groups to item
      [
        {
          ...item,
          ...firstMatch.groups,
        },
        true,
        attribute,
        matches,
      ]
    : firstMatch && firstMatch.length > 1
    ? // Concatenate all capture groups into a single value
      [
        {
          ...item,
          [attribute]: firstMatch.slice(1).join(''),
        },
        true,
        attribute,
        matches,
      ]
    : // Return the item as-is
      [item, Boolean(firstMatch), attribute, matches];
}
