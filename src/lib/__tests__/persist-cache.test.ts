/**
 * Streamed persist-cache writer **and reader** (core/persist-cache.ts).
 *
 * Writer contract: the streamed file is **byte-identical** to
 * `JSON.stringify(ports)` while never allocating the whole output as one
 * string — the V8 `Invalid string length` that the 153k-row `boardgamegeek`
 * import hit.
 *
 * Reader contract: `readPersistedCache` parses that file back into the port
 * map without ever holding the file (or any array) as one string and without
 * one whole-blob `JSON.parse`, so `ImportBGGData`'s >512 MiB cache is actually
 * *restored* instead of silently recomputed. We can't allocate >512 MiB in a
 * unit test, so the large case uses many small items: a round-trip equal to
 * the input proves the chunked, compacting parser reassembles correctly.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readPersistedCache,
  writePersistedCache,
} from '../../../core/persist-cache.ts';

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function tmpFile(name = 'cache.json') {
  dir = mkdtempSync(path.join(tmpdir(), 'cocoon-pc-'));
  return path.join(dir, 'nested', name); // also exercises mkdir on write
}

async function roundtripWrite(ports: Record<string, unknown>) {
  const p = tmpFile();
  await writePersistedCache(p, ports);
  return readFileSync(p, 'utf8');
}

const CASES: [string, Record<string, unknown>][] = [
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
  [
    'number shapes',
    { data: [{ neg: -7, float: -3.5, exp: 1e21, zero: 0, big: 1234567890 }] },
  ],
  ['bool ports', { ok: true, off: false, none: null }],
];

describe('writePersistedCache is byte-identical to JSON.stringify', () => {
  it.each(CASES)('%s', async (_label, ports) => {
    const out = await roundtripWrite(ports);
    expect(out).toBe(JSON.stringify(ports));
    expect(JSON.parse(out)).toEqual(ports);
  });

  it('streams a large array identically (no giant single string)', async () => {
    const data = Array.from({ length: 100_000 }, (_, i) => ({
      id: `row-${i}`,
      v: i,
    }));
    const ports = { data, src: 'SELECT …' };
    const out = await roundtripWrite(ports);
    expect(out).toBe(JSON.stringify(ports));
    expect(JSON.parse(out).data).toHaveLength(100_000);
  });
});

describe('readPersistedCache round-trips writePersistedCache', () => {
  it.each(CASES)('%s', async (_label, ports) => {
    const p = tmpFile();
    await writePersistedCache(p, ports);
    expect(await readPersistedCache(p)).toEqual(ports);
  });

  it('restores a large array (the ImportBGGData shape)', async () => {
    const p = tmpFile();
    const data = Array.from({ length: 100_000 }, (_, i) => ({
      id: `row-${i}`,
      document: { title: `Game ${i}`, rank: i, tags: ['a', 'b'] },
    }));
    await writePersistedCache(p, { data, src: 'SELECT id, document …' });
    const restored = (await readPersistedCache(p)) as {
      data: unknown[];
      src: string;
    };
    expect(restored.data).toHaveLength(100_000);
    expect(restored.data[0]).toEqual(data[0]);
    expect(restored.data[99_999]).toEqual(data[99_999]);
    expect(restored.src).toBe('SELECT id, document …');
  });
});

describe('readPersistedCache parses general JSON, not just our writer', () => {
  it('handles arbitrary whitespace, \\u escapes and nesting', async () => {
    const p = tmpFile();
    await writePersistedCache(p, {}); // creates the nested dir
    // Hand-written: pretty-printed (whitespace our writer never emits),
    // \uXXXX escapes incl. a surrogate pair, varied number shapes.
    const text = `{
      "a" : 1 ,
      "s": "tab\\tnl\\n\\"q\\" back\\\\ slash\\/ caf\\u00e9 \\uD83D\\uDE00",
      "nums": [ -7, -3.5, 3e2, 1E-3, 0, 1234567890 ],
      "lits": [ true, false, null ],
      "deep": { "x": [ { "y": [] } ] },
      "empty": {}
    }`;
    writeFileSync(p, text);
    expect(await readPersistedCache(p)).toEqual(JSON.parse(text));
  });
});

describe('readPersistedCache treats a bad/missing cache as a miss', () => {
  it('rejects on a missing file (Runtime then recomputes)', async () => {
    await expect(
      readPersistedCache(path.join(tmpdir(), 'cocoon-pc-nope', 'x.json'))
    ).rejects.toThrow();
  });

  it('rejects on an empty file', async () => {
    const p = tmpFile();
    await writePersistedCache(p, {}); // creates the dir
    writeFileSync(p, '');
    await expect(readPersistedCache(p)).rejects.toThrow();
  });

  it('rejects on truncated JSON', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { data: [{ a: 1 }] });
    writeFileSync(p, '{"data":[{"a":1}');
    await expect(readPersistedCache(p)).rejects.toThrow();
  });

  it('rejects when the root is not a port object', async () => {
    const p = tmpFile();
    await writePersistedCache(p, {});
    writeFileSync(p, '[1,2,3]');
    await expect(readPersistedCache(p)).rejects.toThrow(
      /not a port object/
    );
  });
});
