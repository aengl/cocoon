/**
 * Reload while a node is RUNNING (regression).
 *
 * The reported bug: a long crawl was in flight; editing cocoon.yml repainted
 * the node `idle` (a `running` node was never "kept" by the selective diff)
 * while its generator kept executing in the background. The zombie run stayed
 * in `inFlightRuns`, so the next `process` joined that promise instead of
 * starting a fresh run — `doRunOne` never re-entered and the node stuck in
 * `queued` forever, with nothing actually running.
 *
 * Two halves of the fix, pinned here:
 *  1. An UNRELATED edit preserves a running node — its crawl is not killed.
 *  2. An edit that RESETS a running node abandons (aborts + drops) its run, so
 *     a re-process starts genuinely fresh and reaches `running`/`done` rather
 *     than sticking in `queued`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';
import { FIXTURE_NODES_DIR } from './fixture-nodes/dir.ts';
import { arm, reset } from './fixture-nodes/Looper.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'reload-running-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => reset());

const write = (file: string, yml: string[]) =>
  writeFileSync(
    path.join(dir, file),
    [`nodeDirs: ['${FIXTURE_NODES_DIR}']`, 'nodes:', ...yml].join('\n')
  );

const snap = (rt: Runtime) => new Map(rt.snapshot());

const waitFor = (rt: Runtime, pred: () => boolean, timeoutMs = 2000) =>
  new Promise<void>((resolve, reject) => {
    if (pred()) return resolve();
    const unsub = rt.onState(() => {
      if (pred()) {
        unsub();
        resolve();
      }
    });
    setTimeout(() => {
      unsub();
      reject(new Error('waitFor timed out'));
    }, timeoutMs);
  });

describe('reload while a node is running', () => {
  it('an unrelated edit PRESERVES a running node — the crawl keeps going', async () => {
    write('preserve.yml', ['  Crawl: { type: Looper }']);
    const rt = await Runtime.load(path.join(dir, 'preserve.yml'));
    const a = arm('Crawl');

    const done = rt.process('Crawl');
    await a.entered;
    await waitFor(rt, () => snap(rt).get('Crawl')!.status === 'running');

    // Add a brand-new, disconnected node — nothing about Crawl or its (empty)
    // upstream changes, so the selective reload must leave Crawl running.
    write('preserve.yml', [
      '  Crawl: { type: Looper }',
      '  Other: { type: Looper }',
    ]);
    await rt.reload();
    expect(snap(rt).get('Crawl')!.status).toBe('running');
    expect(a.cleanedUp()).toBe(false); // run was NOT aborted

    // The very same run finishes normally.
    a.finish();
    await done;
    expect(snap(rt).get('Crawl')!.status).toBe('done');
    expect(rt.readPort('cocoon://Crawl/out/data')).toBe('Crawl');
  });

  it('an edit that RESETS a running node lets a re-process start fresh (not stuck queued)', async () => {
    write('stuck.yml', ['  Crawl: { type: Looper }']);
    const rt = await Runtime.load(path.join(dir, 'stuck.yml'));
    const a1 = arm('Crawl');

    const first = rt.process('Crawl');
    await a1.entered;
    await waitFor(rt, () => snap(rt).get('Crawl')!.status === 'running');

    // Crawl's OWN def changes (a literal param appears) → it resets to idle and
    // its in-flight run is abandoned: aborted (its `finally` runs) and dropped
    // from the dedupe map.
    write('stuck.yml', ['  Crawl: { type: Looper, in: { tweak: 1 } }']);
    await rt.reload();
    expect(snap(rt).get('Crawl')!.status).toBe('idle'); // repainted, not running
    await first; // the superseded pull settles (the aborted run drains) ...
    expect(a1.cleanedUp()).toBe(true); // ... and the doomed run was torn down

    // The human clicks again. WITHOUT the fix this joined the zombie promise
    // and stuck in `queued`; with it, a fresh run reaches `running` then `done`.
    const a2 = arm('Crawl');
    const second = rt.process('Crawl');
    await waitFor(rt, () => snap(rt).get('Crawl')!.status === 'running');
    a2.finish();
    await second;
    expect(snap(rt).get('Crawl')!.status).toBe('done');
    expect(rt.readPort('cocoon://Crawl/out/data')).toBe('Crawl');
  });
});
