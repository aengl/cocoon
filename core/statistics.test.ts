/* tslint:disable:no-implicit-dependencies */
import test from 'ava';
import { domain, interquartileRange } from './statistics';

const iqrDomain = (range: number, values: any[]) => {
  const f = domain(interquartileRange(range, values));
  return values.map(v => f(v));
};

test('can calculate the IQR', t => {
  t.deepEqual(interquartileRange(0, [9, 10, 20, 30, 31]), [10, 30]);
  t.deepEqual(interquartileRange(1, [9, 10, 20, 30, 31]), [-10, 50]);
  t.deepEqual(interquartileRange(1.5, [9, 10, 20, 30, 31]), [-20, 60]);
  t.deepEqual(interquartileRange(2, [9, 10, 20, 30, 31]), [-30, 70]);
});

test('bounds values by midspread', t => {
  t.deepEqual(iqrDomain(0, [9, 10, 20, 30, 31]), [10, 10, 20, 30, 30]);
});

test('bounds values by 1.5 IQR', t => {
  t.deepEqual(iqrDomain(0.5, [9, 10, 20, 30, 31]), [9, 10, 20, 30, 31]);
  t.deepEqual(iqrDomain(0.5, [0, 10, 20, 30, 100]), [0, 10, 20, 30, 40]);
});

test('bounds values by 2 IQR', t => {
  t.deepEqual(iqrDomain(1, [9, 10, 20, 30, 31]), [9, 10, 20, 30, 31]);
  t.deepEqual(iqrDomain(1, [0, 10, 20, 30, 100]), [0, 10, 20, 30, 50]);
});

test('IQR handles null values', t => {
  t.deepEqual(iqrDomain(0, [null, 9, 10, null, 20, 30, 31]), [
    null,
    10,
    10,
    null,
    20,
    30,
    30,
  ]);
});

test('IQR handles data in random order', t => {
  t.deepEqual(iqrDomain(0, [30, 10, 20, 31, 9]), [30, 10, 20, 30, 10]);
  t.deepEqual(iqrDomain(0.5, [100, 20, 0, 10, 30]), [40, 20, 0, 10, 30]);
});
