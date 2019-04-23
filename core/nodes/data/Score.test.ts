/* tslint:disable:no-implicit-dependencies */
import test from 'ava';
import _ from 'lodash';
import { createNodeContext } from '../..';
import { GraphNode } from '../../../common/graph';
import { Score, ScoreConfig } from './Score';

const c: ScoreConfig = {
  attribute: 'score',
  scorers: [
    {
      Identity: {
        attribute: 'a',
      },
    },
    {
      Identity: {
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

function readScores(node: GraphNode) {
  return node.state.cache!.ports.data.map(x => x.score);
}

async function testScorer(
  t: any,
  config: ScoreConfig,
  values: { [attr: string]: any },
  expectedScores: number[]
) {
  const node: GraphNode = {
    definition: {
      type: 'Score',
    },
    edgesIn: [],
    edgesOut: [],
    id: 'Test',
    state: {
      cache: {
        ports: {
          config,
          data: valuesToData(values),
        },
      },
    },
  };
  const context = createNodeContext(node);
  await Score.process(context);
  t.deepEqual(readScores(node), expectedScores);
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
