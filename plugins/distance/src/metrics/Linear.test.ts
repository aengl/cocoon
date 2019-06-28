import test from 'ava';
import { Linear } from './Linear';

const c = {
  attribute: '',
};

test(`calculates the distances between two values`, t => {
  t.is(Linear.compare(c, null, 0, 23), 23);
  t.is(Linear.compare(c, null, -42, 42), 84);
});
