import { NodeObject } from '../../../common/node';
import {
  getMatchedIndexSet,
  getSourceIndex,
  getTargetIndex,
  MatchResult,
} from '../../matchers';

export const FilterMatches: NodeObject = {
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
    const matches = context.readFromPort<MatchResult>('matches');
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    const unmatched = context.readFromPort<boolean>('unmatched');
    const data = source || target;
    if (data === undefined) {
      throw new Error(`no data for either "source" or "target"`);
    }
    const getIndex = source !== undefined ? getSourceIndex : getTargetIndex;
    const matchedSourceIndices = getMatchedIndexSet(matches, getIndex);
    const selectedData = unmatched
      ? data.filter((item, i) => !matchedSourceIndices.has(i))
      : data.filter((item, i) => matchedSourceIndices.has(i));
    context.writeToPort('data', selectedData);
    return `Filtered out ${data.length - selectedData.length} items`;
  },
};
