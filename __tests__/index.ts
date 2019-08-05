import test from 'ava';
import { testDefinition } from '@cocoon/cocoon/src/testing';
import path from 'path';

test('can run index.yml', async t => {
  t.snapshot(await testDefinition(path.resolve(__dirname, 'index.yml')));
});
