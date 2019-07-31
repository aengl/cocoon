import test from 'ava';
import _ from 'lodash';
import { Percent } from './Percent';

test(`calculates the correct distance`, t => {
  t.is(Percent.distance({}, null, 10, 20), 1);
  t.is(Percent.distance({}, null, 20, 10), -0.5);
  t.is(Percent.distance({}, null, 0, 10), Infinity);
  t.is(Percent.distance({}, null, 10, 0), -1);
});
