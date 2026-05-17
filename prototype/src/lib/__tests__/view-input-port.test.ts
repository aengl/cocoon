/**
 * A view bound to an *input* port (`in/<port>/<Type>`) must serialise what
 * the node reads there, not the node's own like-named output. Exercised on a
 * Filter whose input (4 rows) and output (2 kept) differ, so the two view
 * forms produce observably different payloads — the bug was that both read
 * the output. Uses a convention-resolved node for the upstream source.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';
import type { ScatterData } from '../views/scatterplot';

const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-vip-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

mkdirSync(path.join(dir, 'nodes'));
writeFileSync(
  path.join(dir, 'nodes', 'Src.js'),
  `module.exports.Src = { async *process(ctx) {
     ctx.ports.write({ data: [{x:1,y:1},{x:2,y:2},{x:3,y:3},{x:4,y:4}] });
   } };\n`
);

const yml = (view: string) => `nodes:
  Src:
    type: Src
  F:
    type: Filter
    in:
      data: cocoon://Src/out/data
      filter: p => p.x > 2
    view: ${view}
`;

async function viewTotal(view: string): Promise<number> {
  const file = path.join(dir, 'cocoon.yml');
  writeFileSync(file, yml(view));
  const rt = await Runtime.load(file);
  await rt.process('F');
  const data = new Map(rt.snapshot()).get('F')!.viewData as ScatterData;
  return data.total;
}

describe('view bound to an input port', () => {
  it('in/data/... serialises the node input (4 rows), not its output', async () => {
    expect(await viewTotal('in/data/Scatterplot')).toBe(4);
  });

  it('out/data/... still serialises the node output (2 kept)', async () => {
    expect(await viewTotal('out/data/Scatterplot')).toBe(2);
  });
});
