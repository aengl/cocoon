import test from 'ava';
import { testDefinition } from './_helpers';

test('can transform data using a domain', async t => {
  t.snapshot(await testDefinition('domain.yml', 'Domain'));
});
