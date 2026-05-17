/**
 * Multi-edge input ports concatenate — a verbatim port of legacy
 * `graph.ts#getPortData`: `data.length === 1 ? data[0] : _.flatten(data)`
 * (depth-1). This is the *port layer's* job; nodes receive a flat list and
 * never special-case it (legacy `Annotate` is a bare `data.map`). Regression
 * for the live-core finding: `Annotate` fed from `SortByRank/out/data` +
 * `/out/unsortable` was getting an array-of-arrays and throwing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

describe('multi-edge port concatenation (legacy getPortData parity)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'portcat-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, v: unknown) =>
    writeFileSync(path.join(dir, name), JSON.stringify(v));
  const flow = (name: string, yml: string[]) => {
    writeFileSync(path.join(dir, name), ['nodes:', ...yml].join('\n'));
    return Runtime.load(path.join(dir, name));
  };

  it('concatenates two array-producing edges into one flat list', async () => {
    write('a.json', [{ n: 1 }, { n: 2 }]);
    write('b.json', [{ n: 3 }]);
    const rt = await flow('cat.yml', [
      '  A: { in: { uri: a.json }, type: ReadJSON }',
      '  B: { in: { uri: b.json }, type: ReadJSON }',
      '  M:',
      '    in: { data: [cocoon://A/out/data, cocoon://B/out/data], map: "x => x" }',
      '    type: Map',
    ]);
    await rt.process('M');
    // 3, not 2: M saw a flat [{1},{2},{3}], not nested [[..],[..]].
    expect((rt.peek('cocoon://M/out/data') as unknown as { rows: number }).rows).toBe(3);
    expect(new Map(rt.snapshot()).get('M')!.summary).toMatch(/Mapped 3/);
  });

  it('a lone edge passes through untouched (length===1 → data[0])', async () => {
    write('one.json', [{ n: 1 }, { n: 2 }]);
    const rt = await flow('one.yml', [
      '  A: { in: { uri: one.json }, type: ReadJSON }',
      '  M: { in: { data: cocoon://A/out/data, map: "x => x" }, type: Map }',
    ]);
    await rt.process('M');
    expect((rt.peek('cocoon://M/out/data') as unknown as { rows: number }).rows).toBe(2);
  });

  it('flatten is depth-1 and keeps non-array values (lodash _.flatten)', async () => {
    write('arr.json', [{ n: 1 }, { n: 2 }]);
    write('obj.json', { n: 3 }); // a non-array producer
    const rt = await flow('mix.yml', [
      '  A: { in: { uri: arr.json }, type: ReadJSON }',
      '  O: { in: { uri: obj.json }, type: ReadJSON }',
      '  M:',
      '    in: { data: [cocoon://A/out/data, cocoon://O/out/data], map: "x => x" }',
      '    type: Map',
    ]);
    await rt.process('M');
    // _.flatten([[{1},{2}], {3}]) === [{1},{2},{3}] — object appended, not spread.
    expect((rt.peek('cocoon://M/out/data') as unknown as { rows: number }).rows).toBe(3);
  });

  it('the boardgames Annotate shape: two edges, node is bare/faithful', async () => {
    write('left.json', [{ id: 'k1' }, { id: 'k2' }]);
    write('right.json', [{ id: 'k3' }]);
    write('ann.json', { k2: { extra: 'merged' } });
    const rt = await flow('ann.yml', [
      '  A: { in: { uri: left.json }, type: ReadJSON }',
      '  B: { in: { uri: right.json }, type: ReadJSON }',
      '  Ann:',
      '    in:',
      '      data: [cocoon://A/out/data, cocoon://B/out/data]',
      '      key: id',
      '      path: ann.json',
      '    type: Annotate',
    ]);
    await rt.process('Ann'); // must NOT throw "lacking a key attribute"
    const ann = new Map(rt.snapshot()).get('Ann')!;
    expect(ann.status).toBe('done');
    expect(ann.summary).toMatch(/Annotated 1 items/); // only k2 matched
    expect(ann.ports.data).toBe(3); // 2 + 1 concatenated at the port layer
  });
});
