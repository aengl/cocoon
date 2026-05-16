/**
 * Streamed persist-cache writer (core/persist-cache.ts). The contract is
 * exact: the streamed file must be **byte-identical** to
 * `JSON.stringify(ports)` (so Runtime's unchanged `JSON.parse(readFile)`
 * reader behaves identically) while never allocating the whole output as one
 * string — the V8 `Invalid string length` that the 153k-row `boardgamegeek`
 * import hit. We can't allocate >512 MiB in a unit test, so the large case
 * uses many small items: byte-equality there proves the per-item streaming
 * path produces the same result as the (here still-legal) one-shot stringify.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writePersistedCache } from '../../../core/persist-cache.ts';

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

async function roundtrip(ports: Record<string, unknown>) {
  dir = mkdtempSync(path.join(tmpdir(), 'cocoon-pc-'));
  const p = path.join(dir, 'nested', 'cache.json'); // also exercises mkdir
  await writePersistedCache(p, ports);
  return readFileSync(p, 'utf8');
}

describe('writePersistedCache is byte-identical to JSON.stringify', () => {
  it.each([
    ['empty object', {}],
    ['single scalar port', { n: 42 }],
    ['array port', { data: [{ a: 1 }, { a: 2 }, { a: 3 }] }],
    ['empty array', { data: [] }],
    ['mixed ports', { data: [{ x: 1 }], meta: { total: 1 }, src: 'q' }],
    [
      'special chars',
      { data: [{ s: 'quote " backslash \\ \n tab\t', u: 'héllo😀' }] },
    ],
    ['null / nested', { data: [{ a: null, b: { c: [1, [2, 3]] } }] }],
  ])('%s', async (_label, ports) => {
    const out = await roundtrip(ports as Record<string, unknown>);
    expect(out).toBe(JSON.stringify(ports));
    expect(JSON.parse(out)).toEqual(ports);
  });

  it('streams a large array identically (no giant single string)', async () => {
    const data = Array.from({ length: 100_000 }, (_, i) => ({
      id: `row-${i}`,
      v: i,
    }));
    const ports = { data, src: 'SELECT …' };
    const out = await roundtrip(ports);
    expect(out).toBe(JSON.stringify(ports));
    expect(JSON.parse(out).data).toHaveLength(100_000);
  });
});
