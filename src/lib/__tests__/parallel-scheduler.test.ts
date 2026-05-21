/**
 * Parallel execution scheduler (legacy `planner.ts` parity).
 *
 * `runPlan` used to be a single topological `for`-loop with one `await
 * runOne(id)` per node — every plan ran strictly sequentially, and an outer
 * `processChain` further serialised concurrent `process()` calls. The
 * scheduler is now a frontier loop that fires every ready node in parallel
 * and races for completion, with per-node `inFlightRuns` dedupe so two
 * overlapping plans share a single execution of any shared upstream.
 *
 * These tests pin down the four properties that matter:
 *
 *  1. **Concurrency inside one plan** — in a diamond `A → {B, C} → D`, both
 *     B and C are simultaneously inside `process()` while A is done and D
 *     has not started yet. The pre-change implementation could never observe
 *     this: one node ran at a time.
 *  2. **Join semantics** — D fires only after *both* B and C produced
 *     outputs. (Catches a scheduler that races a join-node prematurely.)
 *  3. **Cross-plan dedupe** — two concurrent `process()` calls whose plans
 *     share an upstream run that upstream once, not twice. (The regression
 *     `processChain` used to paper over: a shared persisted upstream
 *     re-executing because two plans overlapped.)
 *  4. **Independent branches survive an upstream error** — a failing branch
 *     blocks only its own dependents; an unrelated parallel branch still
 *     runs to completion in the same plan.
 *
 * The fixture `Gated.ts` blocks `process()` on an externally controlled
 * gate keyed by `ctx.nodeId`, so the assertions are deterministic — we
 * release in chosen orders rather than racing real timers.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';
import { FIXTURE_NODES_DIR } from './fixture-nodes/dir.ts';
import { arm, reset } from './fixture-nodes/Gated.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'parallel-scheduler-'));
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

/** Poll-based wait: resolves once the predicate is satisfied on a state
 *  change. Used because `Runtime.onState` fires on every per-node tick. */
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

describe('parallel execution scheduler', () => {
  it('runs independent branches concurrently in one plan (diamond A→{B,C}→D)', async () => {
    const rt = await writeFlow('diamond.yml', [
      '  A: { type: Gated }',
      '  B: { in: { data: cocoon://A/out/data }, type: Gated }',
      '  C: { in: { data: cocoon://A/out/data }, type: Gated }',
      '  D:',
      '    in: { data: [cocoon://B/out/data, cocoon://C/out/data] }',
      '    type: Gated',
    ]);

    const gA = arm('A');
    const gB = arm('B');
    const gC = arm('C');
    const gD = arm('D');

    const done = rt.process('D');

    // Release A so the scheduler can advance to its dependants.
    await gA.entered;
    gA.release();

    // The smoking-gun assertion: B AND C are *both* parked inside
    // `process()` before either has been released. A serial scheduler
    // would only ever have one of them inside at any given moment.
    await Promise.all([gB.entered, gC.entered]);
    {
      const s = snap(rt);
      expect(s.get('A')!.status).toBe('done');
      expect(s.get('B')!.status).toBe('running');
      expect(s.get('C')!.status).toBe('running');
      // The join node has not started — both inputs are still parked.
      expect(['idle', 'queued']).toContain(s.get('D')!.status);
    }

    // Releasing only one input must not let D start.
    gC.release();
    await waitFor(rt, () => snap(rt).get('C')!.status === 'done');
    expect(snap(rt).get('D')!.status).not.toBe('running');

    // Releasing the other lets D become ready.
    gB.release();
    await gD.entered;
    expect(snap(rt).get('D')!.status).toBe('running');

    gD.release();
    await done;
    expect(snap(rt).get('D')!.status).toBe('done');
  });

  it('dedupes a shared upstream across two concurrent process() calls', async () => {
    // Two targets share one root. Both plans start while Root is parked;
    // the second plan's `runOne(Root)` joins the first's in-flight promise.
    // Body executes exactly once.
    const rt = await writeFlow('shared.yml', [
      '  Root: { type: Gated }',
      '  L: { in: { data: cocoon://Root/out/data }, type: Gated }',
      '  R: { in: { data: cocoon://Root/out/data }, type: Gated }',
    ]);

    const gRoot = arm('Root');
    const gL = arm('L');
    const gR = arm('R');

    // Fire both plans concurrently without awaiting between them.
    const pL = rt.process('L');
    const pR = rt.process('R');

    // Root entered (once); both plans are now waiting on the same promise.
    await gRoot.entered;
    expect(gRoot.entries()).toBe(1);
    // Both plans should have Root queued/running and their own targets
    // queued behind it.
    {
      const s = snap(rt);
      expect(s.get('Root')!.status).toBe('running');
      expect(['queued', 'running']).toContain(s.get('L')!.status);
      expect(['queued', 'running']).toContain(s.get('R')!.status);
    }

    // Release Root. L and R fan out in parallel (they're independent).
    gRoot.release();
    await Promise.all([gL.entered, gR.entered]);
    gL.release();
    gR.release();

    await Promise.all([pL, pR]);

    // The decisive assertion: Root's body ran exactly once, even though
    // two plans both depended on it.
    expect(gRoot.entries()).toBe(1);
    {
      const s = snap(rt);
      expect(s.get('Root')!.status).toBe('done');
      expect(s.get('L')!.status).toBe('done');
      expect(s.get('R')!.status).toBe('done');
    }
  });

  it('blocks failure-side dependents while a parallel branch still finishes', async () => {
    // Diamond with one failing arm:
    //   Src → Bad   → Join   (Bad throws — Join must be blocked)
    //   Src → Good  → Join
    // `Good` is in the plan (Join's upstream), so its completion alongside
    // Bad's throw is the actual parallel claim — not just topo luck.
    const TYPES_DIR = mkdtempSync(path.join(tmpdir(), 'parallel-bad-'));
    afterAll(() => rmSync(TYPES_DIR, { recursive: true, force: true }));
    // Resolver matches `type: X` to a file named `X.{ts,js,…}` — one type
    // per file (keystone-6 convention).
    writeFileSync(
      path.join(TYPES_DIR, 'Bad.ts'),
      `export const Bad = {
         async *process() { throw new Error('boom'); }
       };`
    );
    writeFileSync(
      path.join(TYPES_DIR, 'Pass.ts'),
      `export const Pass = {
         async *process(ctx) {
           const { data } = ctx.ports.read();
           ctx.ports.write({ data: data ?? ctx.nodeId });
           return 'ok';
         }
       };`
    );

    const flowPath = path.join(dir, 'fail.yml');
    writeFileSync(
      flowPath,
      [
        `nodeDirs: ['${TYPES_DIR}', '${FIXTURE_NODES_DIR}']`,
        'nodes:',
        '  Src:  { type: Pass }',
        '  Bad:  { in: { data: cocoon://Src/out/data }, type: Bad }',
        '  Good: { in: { data: cocoon://Src/out/data }, type: Pass }',
        '  Join:',
        '    in: { data: [cocoon://Bad/out/data, cocoon://Good/out/data] }',
        '    type: Pass',
      ].join('\n')
    );
    const rt = await Runtime.load(flowPath);

    await expect(rt.process('Join')).rejects.toThrow(/Cannot process/);

    const s = snap(rt);
    expect(s.get('Src')!.status).toBe('done');
    expect(s.get('Bad')!.status).toBe('error');
    // The crucial parallel claim: an unrelated branch completed inside the
    // same plan in which Bad failed, instead of being stranded by it.
    expect(s.get('Good')!.status).toBe('done');
    expect(s.get('Join')!.status).toBe('error');
    expect(s.get('Join')!.error).toMatch(/Blocked — upstream/);
  });
});
