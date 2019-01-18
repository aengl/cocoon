/* tslint:disable:no-implicit-dependencies */
import test from 'ava';
import { IQR } from './IQR';

const c = {
  attribute: '',
};

test('scores correctly around the IQR', t => {
  const values = [0, 10, 20, 30, 100];
  const expectedScores = [0, 1, 1, 1, 0];
  const config = { ...c, iqr: 0, smooth: 0 };
  const cache = IQR.cache!(config, values);
  t.deepEqual(values.map(v => IQR.score(config, cache, v)), expectedScores);
});

test('scores correctly around the 1 IQR', t => {
  const values = [0, 10, 20, 30, 100];
  const expectedScores = [1, 1, 1, 1, 0];
  const config = { ...c, iqr: 1, smooth: 0 };
  const cache = IQR.cache!(config, values);
  t.deepEqual(values.map(v => IQR.score(config, cache, v)), expectedScores);
});

test('rewards and penalises', t => {
  const values = [0, 10, 20, 30, 100];
  const expectedScores = [-23, 42, 42, 42, -23];
  const config = { ...c, iqr: 0, smooth: 0, reward: 42, penalty: -23 };
  const cache = IQR.cache!(config, values);
  t.deepEqual(values.map(v => IQR.score(config, cache, v)), expectedScores);
});

test('scores correctly using smoothing', t => {
  const values = [0, 5, 10, 10, 15, 20, 25, 30, 30, 45, 50];
  const expectedScores = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0];
  const config = { ...c, iqr: 0, smooth: 0.25 };
  const cache = IQR.cache!(config, values);
  t.deepEqual(values.map(v => IQR.score(config, cache, v)), expectedScores);
  t.is(IQR.score(config, cache, 12.5), 0.5);
  t.is(IQR.score(config, cache, 27.5), 0.5);
});
