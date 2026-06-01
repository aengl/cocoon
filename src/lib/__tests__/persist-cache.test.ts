/**
 * Binary persist-cache writer **and reader** (core/persist-cache.ts).
 *
 * Format: a fixed 14-byte header (magic `COCN`, version, flags, an 8-byte
 * little-endian fingerprint) followed by `v8.serialize(ports)`. vs the former
 * streamed-JSON format this restores natively (no character parse), is smaller
 * on disk, preserves value types, and lifts the ceiling from V8's ~536 MiB
 * single-string cap to the ~2 GiB Buffer cap — so the 153k-row `boardgamegeek`
 * import (which overflowed `JSON.stringify`/`JSON.parse`) round-trips.
 *
 * The on-disk bytes are opaque, so these tests assert *round-trip* behaviour
 * (write → read back equal) and the header contract (magic prefix, head-read
 * fingerprint), not a byte-identical string. We can't allocate >512 MiB in a
 * unit test, so the large case uses many small items: a round-trip equal to the
 * input proves the serializer reassembles correctly.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readCacheFingerprint,
  readPersistedCache,
  writePersistedCache,
} from '../../../core/persist-cache.ts';

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function tmpFile(name = 'cache.json') {
  dir = mkdtempSync(path.join(tmpdir(), 'cocoon-pc-'));
  return path.join(dir, 'nested', name); // also exercises mkdir on write
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

describe('writePersistedCache emits a COCN-headed binary cache', () => {
  it.each(CASES)('%s round-trips through read', async (_label, ports) => {
    const p = tmpFile();
    await writePersistedCache(p, ports);
    expect(await readPersistedCache(p)).toEqual(ports);
  });

  it('writes the COCN magic header', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { n: 1 });
    expect(readFileSync(p).toString('ascii', 0, 4)).toBe('COCN');
  });

  it('serialises a large array without a giant single string', async () => {
    const data = Array.from({ length: 100_000 }, (_, i) => ({
      id: `row-${i}`,
      v: i,
    }));
    const ports = { data, src: 'SELECT …' };
    const p = tmpFile();
    await writePersistedCache(p, ports);
    const restored = (await readPersistedCache(p)) as { data: unknown[] };
    expect(restored.data).toHaveLength(100_000);
  });
});

describe('readCacheFingerprint head-reads the stored fingerprint', () => {
  it('returns the numeric fingerprint the writer stamped', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { data: [{ a: 1 }] }, 42.5);
    expect(await readCacheFingerprint(p)).toBe(42.5);
  });

  it('round-trips a high-precision (fractional ms) fingerprint exactly', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { n: 1 }, 1716900000123.5);
    expect(await readCacheFingerprint(p)).toBe(1716900000123.5);
  });

  it('returns undefined when no fingerprint was given', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { n: 1 });
    expect(await readCacheFingerprint(p)).toBeUndefined();
  });

  it('returns undefined for a legacy (pre-header / JSON) cache', async () => {
    const p = tmpFile();
    await writePersistedCache(p, {}); // creates the dir
    writeFileSync(p, JSON.stringify({ __cocoon: 1, mtime: 5, ports: {} }));
    expect(await readCacheFingerprint(p)).toBeUndefined();
  });

  it('returns undefined for a missing file', async () => {
    expect(
      await readCacheFingerprint(path.join(tmpdir(), 'cocoon-pc-nope', 'x.json'))
    ).toBeUndefined();
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

  it('reports the payload size once via onBytes', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { data: [{ a: 1 }] });
    const seen: number[] = [];
    await readPersistedCache(p, n => seen.push(n));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(0);
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

  it('rejects a legacy (pre-header / JSON) cache as not our format', async () => {
    const p = tmpFile();
    await writePersistedCache(p, {});
    writeFileSync(p, JSON.stringify({ __cocoon: 1, mtime: 5, ports: { n: 1 } }));
    await expect(readPersistedCache(p)).rejects.toThrow(/v2 persist cache/);
  });

  it('rejects a truncated payload', async () => {
    const p = tmpFile();
    await writePersistedCache(p, { data: [{ a: 1 }] });
    // Keep the valid header, corrupt the v8 payload after it.
    const buf = readFileSync(p);
    writeFileSync(p, buf.subarray(0, 16)); // header + 2 stray payload bytes
    await expect(readPersistedCache(p)).rejects.toThrow();
  });

  it('rejects when the payload is not a port object', async () => {
    const p = tmpFile();
    // A valid v2 cache whose payload deserialises to an array, not an object.
    await writePersistedCache(p, [1, 2, 3] as unknown as Record<string, unknown>);
    expect(v8.deserialize(readFileSync(p).subarray(14))).toEqual([1, 2, 3]);
    await expect(readPersistedCache(p)).rejects.toThrow(/not a port object/);
  });
});
