/**
 * Cooperative cancellation (`Runtime.cancel`).
 *
 * A long-running node (a crawl) can be stopped mid-flight. Two mechanisms,
 * both honoured "in the next yield window":
 *
 *  1. **Yield-boundary `gen.return`** — a node that `yield`s/`breathe`s but
 *     ignores `ctx.signal` is stopped purely by the runtime declining to drive
 *     its generator further (`Looper` fixture). Its `finally` still runs.
 *  2. **Signal-wired await** — a node parked in one long `await` wired to
 *     `ctx.signal` has that await rejected at once (`SignalWaiter` fixture).
 *
 * In both cases the run lands `error: "Cancelled"`, its output is dropped, and
 * downstream blocks exactly like any failure. `cancel` on a node that isn't
 * running is a no-op.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';
import { FIXTURE_NODES_DIR } from './fixture-nodes/dir.ts';
import { arm, reset } from './fixture-nodes/Looper.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'cancel-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => reset());

const writeFlow = (name: string, yml: string[]) => {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    [`nodeDirs: ['${FIXTURE_NODES_DIR}']`, 'nodes:', ...yml].join('\n')
  );
  return Runtime.load(file);
};

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

describe('cancellation', () => {
  it('stops a yield/breathe loop → error: Cancelled, output dropped, downstream blocked', async () => {
    const rt = await writeFlow('crawl.yml', [
      '  Crawl: { type: Looper }',
      '  Sink: { in: { data: cocoon://Crawl/out/data }, type: Looper }',
    ]);
    const a = arm('Crawl');

    // Sink depends on Crawl; the plan parks with Crawl crawling.
    const done = rt.process('Sink');
    await a.entered;
    await waitFor(rt, () => snap(rt).get('Crawl')!.status === 'running');
    expect(a.iterations()).toBeGreaterThan(0);

    expect(rt.cancel('Crawl')).toBe(true);

    // The target (Sink) is now blocked, so the plan rejects — same as any
    // upstream failure.
    await expect(done).rejects.toThrow(/Cannot process/);

    const s = snap(rt);
    expect(s.get('Crawl')!.status).toBe('error');
    expect(s.get('Crawl')!.error).toBe('Cancelled');
    // The node's `finally` ran — cancellation is a clean stop, not a kill.
    expect(a.cleanedUp()).toBe(true);
    // No partial output survives.
    expect(rt.readPort('cocoon://Crawl/out/data')).toBeUndefined();
    expect(s.get('Crawl')!.ports).toEqual({});
    // Downstream blocks exactly like a failure.
    expect(s.get('Sink')!.status).toBe('error');
    expect(s.get('Sink')!.error).toMatch(/Blocked — upstream/);
  });

  it('re-processing after a cancel runs clean to done', async () => {
    const rt = await writeFlow('rerun.yml', ['  Crawl: { type: Looper }']);
    const a = arm('Crawl');

    const first = rt.process('Crawl');
    await a.entered;
    await waitFor(rt, () => snap(rt).get('Crawl')!.status === 'running');
    rt.cancel('Crawl');
    await expect(first).rejects.toThrow(/Cannot process/);
    expect(snap(rt).get('Crawl')!.status).toBe('error');

    // Let the loop finish on the next run, then pull again.
    a.finish();
    await rt.process('Crawl');
    expect(snap(rt).get('Crawl')!.status).toBe('done');
    expect(rt.readPort('cocoon://Crawl/out/data')).toBe('Crawl');
  });

  it('cancel on a node that is not running is a no-op (returns false)', async () => {
    const rt = await writeFlow('idle.yml', ['  X: { type: Looper }']);
    expect(rt.cancel('X')).toBe(false);
    expect(snap(rt).get('X')!.status).toBe('idle');
  });

  it('interrupts a single signal-wired await (no intervening yield)', async () => {
    const rt = await writeFlow('signal.yml', ['  Wait: { type: SignalWaiter }']);

    const done = rt.process('Wait');
    await waitFor(rt, () => snap(rt).get('Wait')!.status === 'running');
    expect(rt.cancel('Wait')).toBe(true);
    await expect(done).rejects.toThrow(/Cannot process/);

    const s = snap(rt);
    expect(s.get('Wait')!.status).toBe('error');
    expect(s.get('Wait')!.error).toBe('Cancelled');
    expect(rt.readPort('cocoon://Wait/out/data')).toBeUndefined();
  });
});
