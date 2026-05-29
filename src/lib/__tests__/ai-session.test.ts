/**
 * The AI ↔ live core session: the read surface (introspect.ts) and the full
 * edit→run→error→peek→reload→done debug loop, driven through the real
 * Runtime against the `clab` fixture (the real "document is a JSON string"
 * failure class — see ./fixtures/clab/README.md).
 *
 * The property under test is *boundedness*: every introspection response
 * stays flat regardless of port row count, and the on-throw diagnostics
 * (stack + inputDigest + errorAt) actually localise the bug.
 */
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  digest,
  nodeDetail,
  overview,
  peekData,
  relatives,
} from '../../../core/introspect.ts';
import { Runtime } from '../../../core/runtime.ts';
import { FIXTURE_NODES_DIR } from './fixture-nodes/dir.ts';

const clab = fileURLToPath(new URL('./fixtures/clab', import.meta.url));
const fixedYaml = fileURLToPath(
  new URL('./fixtures/clab/cocoon.fixed.yml', import.meta.url)
);

describe('digest — the bounded primitive', () => {
  it('collapses deep/large structures, keeps small ones verbatim', () => {
    expect(digest({ a: 1, b: 'short' })).toEqual({ a: 1, b: 'short' });
    expect(digest('x'.repeat(200))).toMatch(/^‹string 200c:/);
    expect(digest('x => ({ ...x, y: 1 })\nmore'.repeat(5))).toMatch(/^‹code/);
    const big = Array.from({ length: 5000 }, (_, i) => ({ i, name: `n${i}` }));
    expect(digest(big)).toBe('‹array [{i,name}] ×5000›');
    const deep = { l1: { l2: { l3: { l4: 'unreachable' } } } };
    expect(JSON.stringify(digest(deep))).toMatch(/‹object .* keys\)›/);
  });
});

describe('peekData — schema without bulk', () => {
  const rows = [
    { id: 1, doc: '{"a":1,"s":{"k":2}}' },
    { id: 2, doc: '{"a":9,"s":{"k":3}}' },
  ];
  it('reports type/presence + detects + descends a JSON-string column', () => {
    const p = peekData(rows, { descend: 'doc' }) as any;
    expect(p.rows).toBe(2);
    expect(p.schema.id.type).toBe('number');
    expect(p.schema.doc.type).toBe('json-string');
    expect(p.descended.innerSchema).toMatchObject({
      a: 'number',
      s: expect.stringMatching(/^object \{k\}/),
    });
  });
  it('where/select/limit carve a bounded slice', () => {
    const p = peekData(rows, {
      where: 'x => x.id === 2',
      select: ['id'],
    }) as any;
    expect(p.matched).toBe(1);
    expect(p.sample).toEqual([{ id: 2 }]);
  });
  it('stays flat as row count explodes', () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => ({
      id: i,
      blob: 'z'.repeat(500),
    }));
    const size = JSON.stringify(peekData(huge)).length;
    expect(size).toBeLessThan(1500); // 200k rows, ~1 KB out
  });
  it('where reaches rows past the 500-row summary window', () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => ({
      id: i,
      blob: 'z'.repeat(500),
    }));
    // A targeted lookup scans the whole port…
    const hit = peekData(huge, {
      where: 'x => x.id === 199_999',
      select: ['id'],
    }) as any;
    expect(hit.matched).toBe(1);
    expect(hit.sample).toEqual([{ id: 199_999 }]);
    expect(hit.scanned).toBe(200_000);
    // …but output stays bounded — no `blob` payload leaks across 200k rows.
    expect(JSON.stringify(hit).length).toBeLessThan(1500);
  });
});

describe('overview / relatives — flat on the structure', () => {
  it('summarises clab tiny and lists custom-node load errors when any', async () => {
    const rt = await Runtime.load(path.join(clab, 'cocoon.yml'));
    const ov = overview(rt) as any;
    expect(ov.nodes).toBe(3);
    expect(ov.edges).toBe(2);
    expect(ov.status).toEqual({ idle: 3 });
    expect(ov.types).toMatchObject({ ReadJSON: 1, KMeans: 1, Filter: 1 });
    expect(ov.loadErrors).toBeUndefined(); // KMeans loads cleanly
    expect(JSON.stringify(ov).length).toBeLessThan(800);

    expect(relatives(rt, 'Plot', 'up').map(n => n.id).sort()).toEqual([
      'Cluster',
      'ImportBGGData',
    ]);
    expect(relatives(rt, 'ImportBGGData', 'down').map(n => n.id)).toEqual([
      'Cluster',
      'Plot',
    ]);
  });
});

describe('the debug loop, through the real core', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'clab-'));
  cpSync(clab, dir, { recursive: true });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('errors with stack + inputDigest, peek localises it, reload+fix → done', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));

    // 1. user fires it — Plot is the target, blocked by Cluster's throw.
    await expect(rt.process('Plot')).rejects.toThrow(/Cannot process "Plot"/);
    const s1 = new Map(rt.snapshot());
    const cluster = s1.get('Cluster')!;
    expect(cluster.status).toBe('error');
    expect(cluster.error).toMatch(/non-numeric coordinate/);
    expect(cluster.errorStack).toMatch(/KMeans/); // *where* it threw
    // inputDigest: bounded, but shows the shape that caused it.
    expect(JSON.stringify(cluster.inputDigest)).toMatch(/id,document/);
    expect(JSON.stringify(cluster.inputDigest).length).toBeLessThan(300);
    expect(s1.get('Plot')!.error).toMatch(/Blocked — upstream "Cluster"/);

    // 2. debug: peek the port the failing node reads. ImportBGGData ran
    //    (it's upstream of the plan), so its output is in the store.
    const peek = rt.peek('cocoon://ImportBGGData/out/data', {
      descend: 'document',
    }) as any;
    expect(peek.rows).toBe(12);
    expect(peek.schema.document.type).toBe('json-string'); // the bug, named
    expect(peek.descended.innerSchema.stats).toMatch(/^object/);
    expect(JSON.stringify(peek).length).toBeLessThan(900); // flat

    const slice = rt.peek('cocoon://ImportBGGData/out/data', {
      where: 'x => x.id === 13',
      select: ['id'],
    }) as any;
    expect(slice.matched).toBe(1);
    expect(slice.sample).toEqual([{ id: 13 }]);

    // 3. the AI fixes the flow on disk, then reloads the running core.
    writeFileSync(path.join(dir, 'cocoon.yml'), readFileSync(fixedYaml, 'utf8'));
    await rt.reload();
    const ov = overview(rt) as any;
    expect(ov.nodes).toBe(4); // Parse was inserted
    // Selective reload (NOT a full reset): the fix inserts Parse + rewires
    // Cluster, so Parse/Cluster/Plot are idle — but ImportBGGData's own def
    // is unchanged and it's a source, so its successful result is preserved.
    // The expensive import is not recomputed by the fix — the feature, on
    // the real AI debug loop.
    expect(ov.status).toEqual({ done: 1, idle: 3 });
    expect(new Map(rt.snapshot()).get('ImportBGGData')!.status).toBe('done');
    expect(Object.keys((rt as unknown as { file: { nodes: object } }).file.nodes)).toContain('Parse');

    // 4. re-run: clean. The bounded-payload guarantee (the AI never gets
    //    bulk rows) is already exercised by the `peek` digests above; here
    //    we just confirm the fixed flow runs end-to-end.
    await rt.process('Plot');
    const s2 = new Map(rt.snapshot());
    expect([...s2.values()].every(s => s.status === 'done')).toBe(true);

    const detail = nodeDetail(rt, 'Plot') as any;
    expect(detail.status).toBe('done');
    // A literal param digests instead of dumping the code string.
    const parse = nodeDetail(rt, 'Parse') as any;
    expect(parse.in.params.map).toMatch(/^‹code /);
  });
});

describe('Map/Filter per-item errorAt attribution', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'erat-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('pins the exact offending index + (digested) record', async () => {
    writeFileSync(path.join(dir, 'data.json'), JSON.stringify([1, 2, 3, 4, 5]));
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      [
        // Core ships zero built-in nodes — point at test fixtures.
        `nodeDirs: ['${FIXTURE_NODES_DIR}']`,
        'nodes:',
        '  In:',
        '    in: { uri: data.json }',
        '    type: ReadJSON',
        '  Bad:',
        '    in:',
        '      data: cocoon://In/out/data',
        "      map: 'x => { if (x === 3) throw new Error(\"boom\"); return x; }'",
        '    type: Map',
      ].join('\n')
    );
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await expect(rt.process('Bad')).rejects.toThrow();
    const bad = new Map(rt.snapshot()).get('Bad')!;
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/boom/);
    expect(bad.errorAt).toEqual({ index: 2, record: 3 });
  });
});
