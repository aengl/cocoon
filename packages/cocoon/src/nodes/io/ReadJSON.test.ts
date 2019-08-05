import test from 'ava';
import { ReadJSON, Ports } from './ReadJSON';
import { testNode } from '@cocoon/testing';
import path from 'path';

test('reads JSON from URI', async t => {
  t.snapshot(
    await testNode<Ports>(ReadJSON, {
      uri: 'https://unpkg.com/@cocoon/cocoon@0.100.0/package.json',
    })
  );
});

test('reads JSON from file', async t => {
  t.snapshot(
    await testNode<Ports>(ReadJSON, {
      uri: path.resolve(__dirname, '../../../tsconfig.json'),
    })
  );
});
