/**
 * Stale upstream is reused by default, and the staleness propagates through
 * the target so a derivative-of-stale result is never silently presented as
 * fresh. The opt-out is `process(id, { rerunStale: true })` (the toolbar's
 * shift-click / CLI's `--rerun-stale` route).
 *
 * Default (the cheap-iteration path):
 *  - A `stale` upstream node with outputs is memoised exactly like `done`:
 *    its kept-amber output is fed downstream, the node itself is NOT
 *    re-entered.
 *  - The downstream node that consumes a stale input finishes `stale`, not
 *    `done` — its result is honestly derivative-of-stale; the persist cache
 *    is NOT written for that node either (matches `markStale`'s drop rule).
 *
 * `rerunStale: true`:
 *  - A `stale` upstream is treated like any other to-run node: it actually
 *    re-enters `process()`, transitions stale → queued → running → done, and
 *    downstream then finishes `done`.
 *
 * The fixture `Gated` exposes a per-node `entries()` counter so we can prove
 * "did B's process() actually run this turn?" without relying on timing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';
import { FIXTURE_NODES_DIR } from './fixture-nodes/dir.ts';
import { arm, reset } from './fixture-nodes/Gated.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'stale-reuse-'));
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

/** Release immediately — a "no gate held" run that still records entries. */
const free = (id: string) => {
  const g = arm(id);
  g.release();
  return g;
};

describe('stale upstream reuse + propagation', () => {
  it('reuses stale upstream by default and propagates stale to the target', async () => {
    const rt = await writeFlow('chain.yml', [
      '  A: { type: Gated }',
      '  B: { in: { data: cocoon://A/out/data }, type: Gated }',
      '  C: { in: { data: cocoon://B/out/data }, type: Gated }',
    ]);

    // 1) Seed: run to C end-to-end, everyone done.
    free('A');
    free('B');
    free('C');
    await rt.process('C');
    {
      const s = snap(rt);
      expect(s.get('A')!.status).toBe('done');
      expect(s.get('B')!.status).toBe('done');
      expect(s.get('C')!.status).toBe('done');
    }
    reset();

    // 2) Re-run A directly — markStale propagates to B and C (the kept-amber
    //    "click to re-run" state). Their outputs are kept in `store`.
    free('A');
    await rt.process('A');
    {
      const s = snap(rt);
      expect(s.get('A')!.status).toBe('done');
      expect(s.get('B')!.status).toBe('stale');
      expect(s.get('C')!.status).toBe('stale');
    }
    reset();

    // 3) Run to C with the new default: B (stale, has outputs) is memoised
    //    like a done node — its process() is NOT re-entered. C runs and
    //    finishes `stale` because its direct input B was stale at run time.
    const gA = arm('A'); // armed but should NOT be entered (memoised done)
    const gB = arm('B'); // armed but should NOT be entered (memoised stale)
    const gC = free('C');
    await rt.process('C');

    expect(gA.entries()).toBe(0);
    expect(gB.entries()).toBe(0);
    expect(gC.entries()).toBe(1);
    {
      const s = snap(rt);
      expect(s.get('A')!.status).toBe('done');
      expect(s.get('B')!.status).toBe('stale');
      // Derived from stale → honestly stale, not silently done.
      expect(s.get('C')!.status).toBe('stale');
    }
  });

  it('--rerun-stale forces every stale upstream to recompute', async () => {
    const rt = await writeFlow('chain-rerun.yml', [
      '  A: { type: Gated }',
      '  B: { in: { data: cocoon://A/out/data }, type: Gated }',
      '  C: { in: { data: cocoon://B/out/data }, type: Gated }',
    ]);

    // Seed.
    free('A');
    free('B');
    free('C');
    await rt.process('C');
    reset();

    // Move B + C to stale via an A re-run.
    free('A');
    await rt.process('A');
    expect(snap(rt).get('B')!.status).toBe('stale');
    expect(snap(rt).get('C')!.status).toBe('stale');
    reset();

    // rerunStale: true — B MUST re-enter process() (was stale, now to-run);
    // A stays memoised (it was `done`, not stale); C runs with a fresh B.
    const gA = arm('A');
    const gB = free('B');
    const gC = free('C');
    await rt.process('C', { rerunStale: true });

    expect(gA.entries()).toBe(0); // done is still memoised; --rerun-stale only
                                  // forces *stale* upstream, not *done* ones
    expect(gB.entries()).toBe(1);
    expect(gC.entries()).toBe(1);
    {
      const s = snap(rt);
      expect(s.get('A')!.status).toBe('done');
      expect(s.get('B')!.status).toBe('done');
      expect(s.get('C')!.status).toBe('done');
    }
  });

  it('a previously-stale target finishes done when its inputs are fresh', async () => {
    // The propagation rule reads the *current* input statuses, not the
    // target's prior status — re-pulling a stale target with all-fresh
    // upstream brings it back to `done`. Closes the door on a "once stale,
    // always stale" misimplementation.
    const rt = await writeFlow('target-stale.yml', [
      '  A: { type: Gated }',
      '  B: { in: { data: cocoon://A/out/data }, type: Gated }',
    ]);

    free('A');
    free('B');
    await rt.process('B');
    reset();

    // Re-run A → B goes stale (markStale).
    free('A');
    await rt.process('A');
    expect(snap(rt).get('B')!.status).toBe('stale');
    reset();

    // Pull B. A is `done` (memoised) — B's only input is A, which is NOT
    // stale, so B finishes `done` even though it was stale going in.
    free('B');
    await rt.process('B');
    expect(snap(rt).get('B')!.status).toBe('done');
  });
});
