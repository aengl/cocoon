/* tslint:disable:no-implicit-dependencies */
import test from 'ava-ts';
import { getMatcher } from '.';
import { StringConfig } from './String';

const matcher = getMatcher<StringConfig>('String');

test('matches', t => {
  t.is(matcher.match({}, 'foo', 'foo'), true);
  t.is(matcher.match({}, 'FOO', 'foo'), false);
  t.is(matcher.match({}, 'foo!', 'foo'), false);
});

test('matches with lowercase', t => {
  t.is(matcher.match({ lowercase: true }, 'FOO', 'foo'), true);
});

test('matches with alphabet', t => {
  t.is(matcher.match({ alphabet: 'a-z' }, 'foo!', 'foo'), true);
});

test('matches with alphabet and lowercase', t => {
  t.is(
    matcher.match({ alphabet: 'a-z', lowercase: true }, 'FOO!', 'foo'),
    true
  );
});
