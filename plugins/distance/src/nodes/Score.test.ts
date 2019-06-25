import { testNode } from '@cocoon/testing';
import test from 'ava';
import _ from 'lodash';
import { Config, Score, ScorerConfig } from './Score';

const c: Config = {
  attribute: 'score',
  scorers: [
    {
      Equal: {
        attribute: 'a',
      },
    },
    {
      Equal: {
        attribute: 'b',
      },
    },
  ],
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
  config: Config & ScorerConfig,
  values: { [attr: string]: any },
  expectedScores: number[]
) {
  const result = await testNode(Score, {
    config,
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
    { ...c, normalise: true },
    {
      a: [0, 2, 1, -2],
      b: [-5, 0.5, 4, 2],
    },
    [0, 0.75, 1, 0.5]
  ));

test('can specify domain and range', t =>
  testScorer(
    t,
    _.assign({}, c, {
      scorers: [
        {
          Identity: {
            attribute: 'a',
            domain: [0, 1],
          },
        },
        {
          Identity: {
            attribute: 'b',
            range: [0, 1],
          },
        },
      ],
    }),
    {
      a: [0, 2, null, 1, -2, null],
      b: [0, 1, null, 2, 4, 2],
    },
    [0, 1.25, 0, 1.5, 1, 0.5]
  ));
