import { testNode } from '@cocoon/testing';
import test from 'ava';
import path from 'path';
import { Ports, ReadCSV } from './ReadCSV';

test('reads CSV file', async t => {
  t.snapshot(
    await testNode<Ports>(ReadCSV, {
      uri: path.resolve(__dirname, '../__tests__/test.csv'),
    })
  );
});

test('reads TSV file', async t => {
  t.snapshot(
    await testNode<Ports>(ReadCSV, {
      uri: path.resolve(__dirname, '../__tests__/test.tsv'),
    })
  );
});

test('filters rows', async t => {
  t.snapshot(
    await testNode<Ports>(ReadCSV, {
      filter: x => x.a > 1,
      uri: path.resolve(__dirname, '../__tests__/test.csv'),
    })
  );
});
