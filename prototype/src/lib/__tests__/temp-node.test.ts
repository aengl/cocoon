/**
 * `ctx.processTemporaryNode` — the faithful port of legacy
 * `@cocoon/util/processTemporaryNode` (+ `createTemporaryNodeContext` +
 * `requireCocoonNode`). This is the runtime + `ProcessContext` extension that
 * was the *sole* remaining gate on running tibi's `boardgames.yml` end-to-end
 * (`PublishCollections` composes `Filter` then `Score` mid-`process()`).
 *
 * Exercised through the real `Runtime` so it goes through the keystone-6
 * convention resolver (legacy used a registry map — this proves the
 * registry-free equivalent). Uses the prototype's own ported built-in
 * `Filter`/`Score`, so it has zero tibi dependency: it locks the *mechanism*
 * the holdout needed, mirroring the exact `PublishCollections` shape.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-tmpnode-'));
const nodes = path.join(dir, 'nodes');
mkdirSync(nodes, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const node = (name: string, body: string) =>
  writeFileSync(
    path.join(nodes, `${name}.ts`),
    `export const ${name} = { async *process(ctx) {\n${body}\n} };\n`
  );

// The PublishCollections shape: run Filter, then Score over its result,
// reading each sub-node's outputs off the object passed in.
node(
  'Compose',
  `const { data, filter, attributes } = ctx.ports.read();
   const f = {};
   for await (const _ of ctx.processTemporaryNode('Filter', { data, filter }, f)) {}
   const s = {};
   for await (const _ of ctx.processTemporaryNode('Score', { attributes, data: f.data }, s)) {}
   ctx.ports.write({ data: s.data });
   return 'composed ' + s.data.length;`
);
// Forwards a sub-node's progress (legacy `for await … yield progress`).
node('Yielder', `yield 'p1'; yield ['p2', 0.5]; ctx.ports.write({ ok: true }); return 'y';`);
node(
  'Drive',
  `const got = []; const o = {};
   for await (const p of ctx.processTemporaryNode('Yielder', {}, o)) got.push(p);
   ctx.ports.write({ progress: got, sub: o });`
);
// Self-composite guard + unknown-type error (both surface as node `error`).
node('Selfish', `for await (const _ of ctx.processTemporaryNode('Selfish', {}, {})) {}`);
node('Caller', `for await (const _ of ctx.processTemporaryNode('NoSuchNode', {}, {})) {}`);
// `opts.debug` — the only context field legacy callers ever overrode.
node('Sub', `ctx.debug('FROM_SUB'); ctx.ports.write({});`);
node(
  'Outer',
  `const seen = [];
   for await (const _ of ctx.processTemporaryNode('Sub', {}, {}, { debug: (...a) => seen.push(a.join(' ')) })) {}
   ctx.ports.write({ seen });`
);

writeFileSync(
  path.join(dir, 'cocoon.yml'),
  `nodes:
  Compose:
    type: Compose
    in:
      data:
        - { id: 1, v: 1, keep: true }
        - { id: 2, v: 5, keep: true }
        - { id: 3, v: 9, keep: false }
      filter: 'x => x.keep'
      attributes:
        score_v:
          metrics:
            v:
              type: Linear
          normalise: true
          precision: 3
  Drive: { type: Drive }
  Selfish: { type: Selfish }
  Caller: { type: Caller }
  Outer: { type: Outer }
`
);

describe('ProcessContext.processTemporaryNode', () => {
  it('composes Filter then Score (the PublishCollections shape), capturing outputs', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Compose');

    const out = rt.readPort('cocoon://Compose/out/data') as Record<
      string,
      unknown
    >[];
    // Filter kept the two `keep:true` rows; Score wrote `score_v` onto each.
    expect(out).toHaveLength(2);
    expect(out.every(r => r.keep === true)).toBe(true);
    expect(out.every(r => typeof r.score_v === 'number')).toBe(true);
    expect(new Map(rt.snapshot()).get('Compose')!.summary).toBe('composed 2');
  });

  it('forwards the sub-node progress stream and captures its outputs', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Drive');

    expect(rt.readPort('cocoon://Drive/out/progress')).toEqual([
      'p1',
      ['p2', 0.5],
    ]);
    expect(rt.readPort('cocoon://Drive/out/sub')).toEqual({ ok: true });
  });

  it('rejects a self-composite as the node error', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await expect(rt.process('Selfish')).rejects.toThrow();
    expect(new Map(rt.snapshot()).get('Selfish')!.error).toMatch(
      /a node can not be a composite of itself/
    );
  });

  it('rejects an unknown sub-node type as the node error', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await expect(rt.process('Caller')).rejects.toThrow();
    expect(new Map(rt.snapshot()).get('Caller')!.error).toMatch(
      /Unknown node type "NoSuchNode"/
    );
  });

  it('honours opts.debug for the temporary sub-node', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Outer');
    expect(rt.readPort('cocoon://Outer/out/seen')).toContain('FROM_SUB');
  });
});
