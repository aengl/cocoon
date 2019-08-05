import { snapshotNode } from '@cocoon/testing';
import test from 'ava';
import path from 'path';
import { Ports, ReadJSON } from './ReadJSON';

test('reads JSON from URI', async t => {
  t.snapshot(
    await snapshotNode<Ports>(ReadJSON, {
      uri: 'https://unpkg.com/@cocoon/cocoon@0.100.0/package.json',
    })
  );
});

test('reads JSON from file', async t => {
  t.snapshot(
    await snapshotNode<Ports>(ReadJSON, {
      uri: path.resolve(__dirname, '../../../tsconfig.json'),
    })
  );
});
