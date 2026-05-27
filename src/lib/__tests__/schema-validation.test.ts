/**
 * The schema-aware `ctx.ports.read/write` + `ctx.controls.read` overload:
 * an optional zod schema parses at the seam, so a shape mismatch fails the
 * node cleanly (and — per the engine's contract — blocks downstream).
 * The valid path returns the parsed value; the invalid path surfaces the
 * zod error as the node's `error` status.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

const NODE_SRC = `
import { z } from 'zod';
const Inputs = z.object({ foo: z.string() });
export const Schemy = {
  async *process(ctx) {
    const { foo } = ctx.ports.read(Inputs);
    ctx.ports.write({ echoed: foo.toUpperCase() });
    return 'ok';
  },
};
`;

function scaffold(input: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-schema-'));
  mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  writeFileSync(path.join(dir, 'nodes', 'Schemy.ts'), NODE_SRC);
  writeFileSync(
    path.join(dir, 'cocoon.yml'),
    `nodes:\n  N:\n    type: Schemy\n    in:\n      foo: ${input}\n`
  );
  return dir;
}

describe('ctx.ports.read(schema)', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

  it('parses and returns typed data on a valid payload', async () => {
    const dir = scaffold('"hello"');
    dirs.push(dir);
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('N');
    const state = new Map(rt.snapshot()).get('N')!;
    expect(state.status).toBe('done');
    expect(state.summary).toBe('ok');
  });

  it('fails the node with the zod error on a shape mismatch', async () => {
    const dir = scaffold('123');
    dirs.push(dir);
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await expect(rt.process('N')).rejects.toThrow();
    const state = new Map(rt.snapshot()).get('N')!;
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/foo/);
  });
});
