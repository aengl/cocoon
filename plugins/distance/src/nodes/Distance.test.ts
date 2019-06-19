// import { testNode } from '@cocoon/testing';
import test from 'ava';
// import _ from 'lodash';
import { Distance, DistanceConfig, indexForTopN } from './Distance';

// const c: DistanceConfig = {
//   attribute: 'distance',
//   distances: {
//     a: true,
//   },
// };

// const data = [
//   { a: 0, b: 0, c: 0, d: 0 },
//   { a: 0, b: 0, c: 0, d: 0 },
//   { a: 1, b: 0, c: 0, d: 0 },
//   { a: 1, b: 0, c: 0, d: 0 },
//   { a: 2, b: 0, c: 0, d: 0 },
//   { a: 2, b: 0, c: 0, d: 0 },
//   { a: 3, b: 0, c: 0, d: 0 },
//   { a: 4, b: 0, c: 0, d: 0 },
//   { a: 10, b: 0, c: 0, d: 0 },
//   { a: -10, b: 0, c: 0, d: 0 },
// ];

// async function testDistances(
//   t: any,
//   config: DistanceConfig,
//   expectedScores: number[]
// ) {
//   const result = await testNode(Distance, {
//     config,
//     data,
//   });
//   t.deepEqual(result.data.map(x => x.score), expectedScores);
// }

// test('creates correct distances', t => testDistances(t, c, [10, 10, 10, 10]));

test('can select best indices', t => {
  t.deepEqual(indexForTopN([23, 5, 42, 0, 12], 3, 0), [3, 1, 4]);
  t.deepEqual(indexForTopN([23, 5, 42, 0, 12], 3, 3), [1, 4, 0]);
  t.deepEqual(indexForTopN([null, 5, null, 0, 12], 3, 0), [3, 1, 4]);
});
