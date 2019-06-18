import test from 'ava';
import { Linear } from './Linear';

const c = {
  attribute: '',
};

test('calculates distances correctly', t => {
  t.is(Linear.distance(c, null, 0, 23), 23);
  t.is(Linear.distance(c, null, -42, 42), 84);
  t.is(Linear.distance(c, null, null, 222), null);
});
