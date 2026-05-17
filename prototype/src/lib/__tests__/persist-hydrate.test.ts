/**
 * Persisted nodes restore from their disk cache **without a run** — legacy
 * Cocoon parity — but in the **background**, never blocking `load()`. The
 * original bug: restoration only happened inside `runOne()`, so a persisted
 * node showed nothing until something ran it. The over-correction: doing it
 * inside `Runtime.load()` and awaiting it froze the whole core, because
 * `serve()` only opens its socket after `load()` resolves and a single cache
 * (ImportBGGData ≈ 542 MiB) takes real time to stream-parse. The fix:
 * `hydrate()` runs the restore in the background and streams each node to
 * `done` as its cache finishes; `whenHydrated()` resolves when it's done.
 * Either way a persisted node comes up `done` with **zero `process()` calls**,
 * and a downstream run memoises it instead of recomputing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writePersistedCache } from '../../../core/persist-cache.ts';
import { Runtime } from '../../../core/runtime.ts';

describe('persisted nodes hydrate from disk cache (background, no run)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'persist-hydrate-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const flow = (name: string, yml: string[]) => {
    writeFileSync(path.join(dir, name), ['nodes:', ...yml].join('\n'));
    return Runtime.load(path.join(dir, name));
  };
  // Cache lives next to the flow at _cocoon_cache/<id>.json (cachePath()).
  const seedCache = (id: string, ports: Record<string, unknown>) =>
    writePersistedCache(path.join(dir, '_cocoon_cache', `${id}.json`), ports);

  it('load() does NOT block on hydration — node is still idle', async () => {
    await seedCache('Src', { data: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    const rt = await flow('nofreeze.yml', [
      '  Src: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    // The freeze regression was `load()` awaiting the (potentially 542 MiB)
    // parse. It must return without having done it: node still `idle`.
    expect(new Map(rt.snapshot()).get('Src')!.status).toBe('idle');
  });

  it('comes up `done` from cache after hydrate(), no process()', async () => {
    await seedCache('Src', { data: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    const rt = await flow('load.yml', [
      '  Src: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    await rt.hydrate(); // background restore — explicitly NOT a process()/run
    const st = new Map(rt.snapshot()).get('Src')!;
    expect(st.status).toBe('done');
    expect(st.summary).toMatch(/Restored from cache/);
    expect(st.ports.data).toBe(3);
    expect(
      (rt.peek('cocoon://Src/out/data') as unknown as { rows: number }).rows
    ).toBe(3);
  });

  it('a cold node visibly streams through `running` before `done`', async () => {
    await seedCache('Src', { data: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    const rt = await flow('visible.yml', [
      '  Src: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    const seen: { status: string; progress?: string | number }[] = [];
    const off = rt.onState((id, st) => {
      if (id === 'Src') seen.push({ status: st.status, progress: st.progress });
    });
    await rt.hydrate();
    off();
    // It must not jump idle -> done in one step (the original "doesn't show"
    // bug): the editor needs a `running` frame, and it carries the restore
    // message so the status line reads as work, not a generic spinner.
    const running = seen.filter(s => s.status === 'running');
    expect(running.length).toBeGreaterThan(0);
    expect(String(running[0].progress)).toMatch(/Restoring from cache/);
    expect(seen.at(-1)!.status).toBe('done');
  });

  it('a downstream run memoises the restored node (no recompute)', async () => {
    // `uri` points at a non-existent file: if the persisted node were
    // recomputed instead of served from cache, ReadJSON would error.
    await seedCache('Src', { data: [{ n: 10 }, { n: 20 }] });
    const rt = await flow('memo.yml', [
      '  Src: { in: { uri: missing.json }, persist: true, type: ReadJSON }',
      '  M: { in: { data: cocoon://Src/out/data, map: "x => x" }, type: Map }',
    ]);
    await rt.hydrate();
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

  it('a run that beats hydration still serves from cache once', async () => {
    // Don't await hydrate(): the run reaches Src before the background
    // restore streamed that far. The in-flight de-dupe means they share one
    // parse; Src is served from cache (ReadJSON's missing `uri` never errors).
    await seedCache('Src', { data: [{ n: 5 }, { n: 6 }] });
    const rt = await flow('race.yml', [
      '  Src: { in: { uri: missing.json }, persist: true, type: ReadJSON }',
      '  M: { in: { data: cocoon://Src/out/data, map: "x => x" }, type: Map }',
    ]);
    rt.hydrate(); // started, NOT awaited — racing the run below
    await rt.process('M');
    const snap = new Map(rt.snapshot());
    expect(snap.get('Src')!.status).toBe('done');
    expect(snap.get('Src')!.summary).toMatch(/Restored from cache/);
    expect(snap.get('M')!.status).toBe('done');
    await rt.whenHydrated(); // background hydrate settles cleanly too
    expect(new Map(rt.snapshot()).get('Src')!.status).toBe('done');
  });

  it('reload() re-hydrates persisted nodes (background)', async () => {
    await seedCache('Src', { data: [{ n: 7 }] });
    const rt = await flow('reload.yml', [
      '  Src: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    await rt.hydrate();
    expect(new Map(rt.snapshot()).get('Src')!.status).toBe('done');
    await rt.reload();
    // reload() resets to idle and kicks off a background hydrate it doesn't
    // await — so the snapshot is idle until hydration settles.
    await rt.whenHydrated();
    const st = new Map(rt.snapshot()).get('Src')!;
    expect(st.status).toBe('done');
    expect(st.summary).toMatch(/Restored from cache/);
    expect(st.ports.data).toBe(1);
  });

  it('no cache file: node stays idle (not errored) after hydrate()', async () => {
    // `Fresh` is never seeded — distinct id so the shared-dir cache from
    // other cases can't leak in.
    const rt = await flow('nocache.yml', [
      '  Fresh: { in: { uri: nope.json }, persist: true, type: ReadJSON }',
    ]);
    await rt.hydrate();
    expect(new Map(rt.snapshot()).get('Fresh')!.status).toBe('idle');
  });
});
