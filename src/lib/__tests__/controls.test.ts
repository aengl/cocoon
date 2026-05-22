/**
 * Steering controls (keystone 5) end-to-end through the real Runtime.
 *
 * The contract under test:
 *  - schema is **lazy** — code-declared, streamed in node-state only once the
 *    module has resolved (keystone-6 pull-triggered resolution); not visible
 *    before the first run;
 *  - the effective value is `override ?? schema.default`, reaches `process()`
 *    via `ctx.controls.read()`, and is **never** YAML;
 *  - `setControl` is the `setPersist` twin: a session override that ages the
 *    node + its downstream (`stale`) with **no upstream pull and no eager
 *    cascade** — the user re-pulls;
 *  - an invalid key/value/unknown-node/not-yet-resolved write is a silent
 *    no-op (fire-and-forget);
 *  - overrides survive a `reload` for surviving nodes;
 *  - the agent read surface (`nodeDetail`) exposes `controls` + `controlState`
 *    and the matching act is `setControl` — proven on the real clab `KMeans`.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeDetail } from '../../../core/introspect.ts';
import { Runtime } from '../../../core/runtime.ts';

const clabFixed = fileURLToPath(
  new URL('./fixtures/clab/cocoon.fixed.yml', import.meta.url)
);

/**
 * A project-local custom node declaring all four steering kinds and echoing
 * the *effective* control values straight to its output — so a read of the
 * port is exactly what `ctx.controls.read()` saw.
 */
const TWEAK = `
export const Tweak = {
  category: 'Test',
  controls: {
    enabled: { kind: 'toggle', default: true },
    mode: { kind: 'select', options: ['a', 'b', 'c'], default: 'b' },
    note: { kind: 'text', default: 'hi', placeholder: '…' },
    n: { kind: 'number', default: 2, min: 0, max: 10 },
  },
  async *process(ctx) {
    const c = ctx.controls.read();
    ctx.ports.write({ data: [c] });
    return 'n=' + c.n + ' mode=' + c.mode;
  },
};
`;

const FLOW = [
  'nodes:',
  '  T:',
  '    type: Tweak',
  '  Down:',
  '    in: { data: cocoon://T/out/data }',
  '    type: Tweak',
  '',
].join('\n');

function scaffold() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ctrl-'));
  mkdirSync(path.join(dir, 'nodes'));
  writeFileSync(path.join(dir, 'nodes', 'Tweak.ts'), TWEAK);
  writeFileSync(path.join(dir, 'cocoon.yml'), FLOW);
  return dir;
}

const stateOf = (rt: Runtime, id: string) => new Map(rt.snapshot()).get(id)!;
const portOf = (rt: Runtime, id: string) =>
  (rt.readPort(`cocoon://${id}/out/data`) as Record<string, unknown>[])[0];

describe('steering controls — lazy schema, value overlay, pure pull', () => {
  const dirs: string[] = [];
  afterAll(() =>
    dirs.forEach(d => rmSync(d, { recursive: true, force: true }))
  );
  const fresh = () => {
    const d = scaffold();
    dirs.push(d);
    return path.join(d, 'cocoon.yml');
  };

  it('schema is absent until the module resolves, then defaults apply', async () => {
    const rt = await Runtime.load(fresh());
    // Lazy: nothing resolved at load — no schema until first run/peek.
    expect(stateOf(rt, 'T').controls).toBeUndefined();
    expect(stateOf(rt, 'T').controlState).toBeUndefined();

    await rt.process('T');
    const t = stateOf(rt, 'T');
    expect(t.status).toBe('done');
    expect(Object.keys(t.controls!)).toEqual(['enabled', 'mode', 'note', 'n']);
    // Effective = schema defaults (no override yet).
    expect(t.controlState).toEqual({
      enabled: true,
      mode: 'b',
      note: 'hi',
      n: 2,
    });
    // ...and that is exactly what ctx.controls.read() fed process().
    expect(portOf(rt, 'T')).toEqual({
      enabled: true,
      mode: 'b',
      note: 'hi',
      n: 2,
    });
  });

  it('setControl overrides the value, ages node + downstream, no upstream/no cascade', async () => {
    const rt = await Runtime.load(fresh());
    await rt.process('Down'); // T → Down, both done
    expect(stateOf(rt, 'T').status).toBe('done');
    expect(stateOf(rt, 'Down').status).toBe('done');

    await rt.setControl('T', 'n', 5);
    await rt.setControl('T', 'note', 'translated text'); // the `text` kind

    // Pure pull: T and its downstream go stale; nothing re-runs on its own.
    expect(stateOf(rt, 'T').status).toBe('stale');
    expect(stateOf(rt, 'Down').status).toBe('stale');
    expect(
      [...new Map(rt.snapshot()).values()].some(s => s.status === 'running')
    ).toBe(false);
    // Effective state reflects the override immediately (streamed).
    expect(stateOf(rt, 'T').controlState).toMatchObject({
      n: 5,
      note: 'translated text',
    });

    // Apply the new value: pull T directly (the target always recomputes).
    // Pulling Down instead would reuse T's stale output — the upstream-reuse
    // default that makes downstream iteration cheap; Down would finish
    // `stale` itself. To get the new value, the user pulls T.
    await rt.process('T');
    expect(portOf(rt, 'T')).toMatchObject({ n: 5, note: 'translated text' });
    expect(stateOf(rt, 'T').status).toBe('done');
    // T is now done; pulling Down picks up the new T output (T is memoised
    // as `done`, Down re-runs with the fresh data).
    await rt.process('Down');
    expect(stateOf(rt, 'Down').status).toBe('done');
  });

  it('setControl to the same effective value does NOT age the node', async () => {
    const rt = await Runtime.load(fresh());
    await rt.process('Down');
    expect(stateOf(rt, 'T').status).toBe('done');
    expect(stateOf(rt, 'Down').status).toBe('done');

    // Re-select the SCHEMA DEFAULT (no override yet) — opening a dropdown and
    // clicking the same value. Effective value is unchanged.
    await rt.setControl('T', 'mode', 'b'); // 'b' is the declared default
    expect(stateOf(rt, 'T').status).toBe('done');
    expect(stateOf(rt, 'Down').status).toBe('done');

    // First real change ages, as expected.
    await rt.setControl('T', 'mode', 'a');
    expect(stateOf(rt, 'T').status).toBe('stale');
    expect(stateOf(rt, 'Down').status).toBe('stale');

    // Pull to apply, then re-select the same override — still no-op.
    await rt.process('T');
    await rt.process('Down');
    expect(stateOf(rt, 'T').status).toBe('done');
    await rt.setControl('T', 'mode', 'a');
    expect(stateOf(rt, 'T').status).toBe('done');
    expect(stateOf(rt, 'Down').status).toBe('done');
  });

  it('invalid / unknown / wrong-kind writes are silent no-ops', async () => {
    const rt = await Runtime.load(fresh());
    await rt.process('T');

    await rt.setControl('T', 'mode', 'zzz'); // not an option
    await rt.setControl('T', 'n', 'seven' as unknown as number); // wrong kind
    await rt.setControl('T', 'n', 99); // out of [0,10]
    await rt.setControl('T', 'ghostKey', 1); // unknown control
    await rt.setControl('NoNode', 'n', 1); // unknown node — must not throw

    const t = stateOf(rt, 'T');
    expect(t.status).toBe('done'); // nothing aged it — every write rejected
    expect(t.controlState).toEqual({
      enabled: true,
      mode: 'b',
      note: 'hi',
      n: 2,
    });
    expect('ghostKey' in (t.controlState as object)).toBe(false);
  });

  it('a write before the schema has resolved is a no-op (lazy)', async () => {
    const rt = await Runtime.load(fresh());
    // T never ran → module unresolved → schema unknown → cannot validate.
    await rt.setControl('T', 'n', 9);
    await rt.process('T');
    expect(stateOf(rt, 'T').controlState).toMatchObject({ n: 2 }); // default
    expect(portOf(rt, 'T')).toMatchObject({ n: 2 });
  });

  it('overrides survive a reload for surviving nodes', async () => {
    const file = fresh();
    const rt = await Runtime.load(file);
    await rt.process('T');
    await rt.setControl('T', 'n', 7);
    await rt.reload(); // same file; T unchanged
    // Selective reload keeps an unchanged node's state — here the `stale`
    // that setControl left it in (last output still visible) — and the n=7
    // override, being runtime not YAML, rides through it independently.
    expect(stateOf(rt, 'T').status).toBe('stale');
    await rt.process('T');
    expect(portOf(rt, 'T')).toMatchObject({ n: 7 }); // override file-independent
  });
});

describe('agent surface — controls on the real clab KMeans', () => {
  it('nodeDetail exposes schema + state; setControl steers it (pull-only)', async () => {
    const rt = await Runtime.load(clabFixed);
    // Run to the sink so the whole chain (incl. downstream Plot) is `done` —
    // markStale only ages a previously-`done` node, so the steering contract
    // is only observable on a fully-run graph.
    await rt.process('Plot');

    const d1 = nodeDetail(rt, 'Cluster') as any;
    expect(d1.status).toBe('done');
    expect(Object.keys(d1.controls)).toEqual(['k', 'metric', 'normalize']);
    expect(d1.controlState).toEqual({
      k: 3,
      metric: 'euclidean',
      normalize: false,
    });

    // The agent's act surface: write via setControl, read it back.
    await rt.setControl('Cluster', 'metric', 'manhattan');
    const d2 = nodeDetail(rt, 'Cluster') as any;
    expect(d2.controlState.metric).toBe('manhattan');
    expect(d2.status).toBe('stale'); // aged, not recomputed (pull graph)
    // Steering contract: downstream stale, upstream untouched.
    expect(new Map(rt.snapshot()).get('Plot')!.status).toBe('stale');
    expect(new Map(rt.snapshot()).get('ImportBGGData')!.status).toBe('done');

    await rt.process('Cluster');
    const d3 = nodeDetail(rt, 'Cluster') as any;
    expect(d3.status).toBe('done');
    expect(d3.summary).toMatch(/manhattan/);
  });
});
