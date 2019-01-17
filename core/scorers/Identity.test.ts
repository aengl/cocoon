/* tslint:disable:no-implicit-dependencies */
import test from 'ava';
import { Identity } from './Identity';

const c = {
  attribute: '',
};

test('scores correctly', t => {
  t.is(Identity.score(c, null, 42), 42);
  t.is(Identity.score(c, null, -23), -23);
  t.is(Identity.score(c, null, null), null);
});
