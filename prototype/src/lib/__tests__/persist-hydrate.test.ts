/**
 * Persisted nodes restore from their disk cache **on load/reload**, not
 * lazily on first run — legacy Cocoon parity. The bug: after the streamed
 * reader landed, `ImportBGGData` still showed nothing when the core loaded
 * `boardgames.yml`, because restoration only happened inside `runOne()`.
 * `Runtime.load()` / `reload()` now call `hydratePersisted()`, so a persisted
 * node comes up `done` with its ports populated with **zero `process()`
 * calls**, and a downstream run memoises it instead of recomputing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writePersistedCache } from '../../../core/persist-cache.ts';
import { Runtime } from '../../../core/runtime.ts';

describe('persisted nodes hydrate from disk cache on load (no run)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'persist-hydrate-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const flow = (name: string, yml: string[]) => {
    writeFileSync(path.join(dir, name), ['nodes:', ...yml].join('\n'));
    return Runtime.load(path.join(dir, name));
  };
  // Cache lives next to the flow at _cocoon_cache/<id>.json (cachePath()).
  const seedCache = (id: string, ports: Record<string, unknown>) =>
    writePersistedCache(path.join(dir, '_cocoon_cache', `${id}.json`), ports);

  it('comes up `done` from cache at load with no process()', async () => {
    await seedCache('Src', { data: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    const rt = await flow('load.yml', [
      '  Src: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    // No rt.process() call anywhere.
    const st = new Map(rt.snapshot()).get('Src')!;
    expect(st.status).toBe('done');
    expect(st.summary).toMatch(/Restored from cache/);
    expect(st.ports.data).toBe(3);
    expect(
      (rt.peek('cocoon://Src/out/data') as unknown as { rows: number }).rows
    ).toBe(3);
  });

  it('a downstream run memoises the restored node (no recompute)', async () => {
    // `uri` points at a non-existent file: if the persisted node were
    // recomputed instead of served from cache, ReadJSON would error.
    await seedCache('Src', { data: [{ n: 10 }, { n: 20 }] });
    const rt = await flow('memo.yml', [
      '  Src: { in: { uri: missing.json }, persist: true, type: ReadJSON }',
      '  M: { in: { data: cocoon://Src/out/data, map: "x => x" }, type: Map }',
    ]);
    await rt.process('M');
    const snap = new Map(rt.snapshot());
    expect(snap.get('Src')!.status).toBe('done');
    // Summary still the cache restore — proves Src was never re-run.
    expect(snap.get('Src')!.summary).toMatch(/Restored from cache/);
    expect(snap.get('M')!.status).toBe('done');
    expect(
      (rt.peek('cocoon://M/out/data') as unknown as { rows: number }).rows
    ).toBe(2);
  });

  it('reload() re-hydrates persisted nodes', async () => {
    await seedCache('Src', { data: [{ n: 7 }] });
    const rt = await flow('reload.yml', [
      '  Src: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    expect(new Map(rt.snapshot()).get('Src')!.status).toBe('done');
    await rt.reload();
    const st = new Map(rt.snapshot()).get('Src')!;
    expect(st.status).toBe('done');
    expect(st.summary).toMatch(/Restored from cache/);
    expect(st.ports.data).toBe(1);
  });

  it('no cache file: node stays idle (not errored) until run', async () => {
    // `Fresh` is never seeded — distinct id so the shared-dir cache from
    // other cases can't leak in.
    const rt = await flow('nocache.yml', [
      '  Fresh: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    expect(new Map(rt.snapshot()).get('Fresh')!.status).toBe('idle');
  });
});
