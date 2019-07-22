import test from 'ava';
import { Linear } from './Linear';

const c = {
  attribute: '',
};

test(`scores a single value`, t => {
  t.is(Linear.score(c, null, 0), 0);
  t.is(
    Linear.score(
      {
        ...c,
        value: 23,
      },
      null,
      42
    ),
    19
  );
});

test(`calculates the distances between two values`, t => {
  t.is(Linear.distance(c, null, 0, 23), -23);
  t.is(Linear.distance(c, null, 42, -42), 84);
});
