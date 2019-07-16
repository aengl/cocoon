import { testNode } from '@cocoon/testing';
import test from 'ava';
import _ from 'lodash';
import { Ports, Score } from './Score';

const c: Ports['attributes'] = {
  score: {
    metrics: {
      a: { type: 'Equal' },
      b: { type: 'Equal' },
    },
  },
};

function valuesToData(values: { [attr: string]: any }) {
  const keys = Object.keys(values);
  return values[keys[0]].map((_0, i) => {
    return Object.keys(values).reduce((obj, key) => {
      obj[key] = values[key][i];
      return obj;
    }, {});
  });
}

async function testScorer(
  t: any,
  config: Ports['attributes'],
  values: { [attr: string]: any },
  expectedScores: number[]
) {
  const result = await testNode(Score, {
    attributes: config,
    data: valuesToData(values),
  });
  t.deepEqual(result.data.map(x => x.score), expectedScores);
}

test('scores correctly', t =>
  testScorer(
    t,
    c,
    {
      a: [5, 0, 10, -5],
      b: [5, 10, 0, 15],
    },
    [10, 10, 10, 10]
  ));

test('handles nil values', t =>
  testScorer(
    t,
    c,
    {
      a: [null, undefined, null, 42],
      b: [null, null, 23, undefined],
    },
    [0, 0, 23, 42]
  ));

test('normalises correctly', t =>
  testScorer(
    t,
    _.merge({}, c, { score: { normalise: true } }),
    {
      a: [0, 2, 1, -2],
      b: [-5, 0.5, 4, 2],
    },
    [0, 0.75, 1, 0.5]
  ));
