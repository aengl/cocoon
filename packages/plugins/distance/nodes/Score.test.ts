import { snapshotNode } from '@cocoon/testing';
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
  values: { [attr: string]: any }
) {
  t.snapshot(
    await snapshotNode(Score, {
      attributes: config,
      data: valuesToData(values),
    })
  );
}

test('scores correctly', t =>
  testScorer(t, c, {
    a: [5, 0, 10, -5],
    b: [5, 10, 0, 15],
  }));

test('handles nil values', t =>
  testScorer(t, c, {
    a: [null, undefined, null, 42],
    b: [null, null, 23, undefined],
  }));

test('normalises correctly', t =>
  testScorer(t, _.merge({}, c, { score: { normalise: true } }), {
    a: [0, 2, 1, -2],
    b: [-5, 0.5, 4, 2],
  }));
