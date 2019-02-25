import { NodeObject } from '../../../common/node';
import {
  getMatchedIndexSet,
  getSourceIndex,
  getTargetIndex,
  MatchResult,
} from '../../matchers';

export const FilterMatches: NodeObject = {
  category: 'Filter',

  in: {
    matches: {
      required: true,
    },
    source: {},
    target: {},
    unmatched: {
      defaultValue: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const matches = context.ports.read<MatchResult>('matches');
    const source = context.ports.read<object[]>('source');
    const target = context.ports.read<object[]>('target');
    const unmatched = context.ports.read<boolean>('unmatched');
    const data = source || target;
    if (data === undefined) {
      throw new Error(`no data for either "source" or "target"`);
    }
    const getIndex = source !== undefined ? getSourceIndex : getTargetIndex;
    const matchedSourceIndices = getMatchedIndexSet(matches, getIndex);
    const selectedData = unmatched
      ? data.filter((item, i) => !matchedSourceIndices.has(i))
      : data.filter((item, i) => matchedSourceIndices.has(i));
    context.ports.writeAll({ data: selectedData });
    return `Filtered out ${data.length - selectedData.length} items`;
  },
};
