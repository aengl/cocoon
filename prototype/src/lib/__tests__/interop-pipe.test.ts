/**
 * The interop example's node type — Pipe — proven through Runtime: a
 * collection serialised to a child process' stdin and the result read back
 * from stdout, exactly the `interop` shape (legacy used ./generator.py /
 * ./plot.r; here a `#!/usr/bin/env node` script keeps the suite free of a
 * python/R dependency). Plus the non-zero-exit error path, which must surface
 * as a node `error` (not a thrown plan abort).
 *
 * The real `interop` example is smoke-tested separately and manually: it
 * needs python3 (present) for GenerateInPython and R (NOT installed here) for
 * VisualiseInR — which writes a file-backed `out:` port displayed by the
 * migrated `Image` node (`core/nodes/Image.ts`; see image-view.test.ts).
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

describe('interop Pipe (collection ↔ child process via stdin/stdout)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-pipe-'));

  beforeAll(() => {
    // Doubles every number; mirrors interop's generator.py contract.
    writeFileSync(
      path.join(dir, 'double.js'),
      `#!/usr/bin/env node
let s = '';
process.stdin.on('data', d => (s += d)).on('end', () => {
  process.stdout.write(JSON.stringify(JSON.parse(s).map(x => x * 2)));
});
`
    );
    chmodSync(path.join(dir, 'double.js'), 0o755);
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      `nodes:
  Gen:
    in:
      command: ./double.js
      data: [1, 2, 3]
      serialise: JSON.stringify
      deserialise: JSON.parse
    type: Pipe
  Echo:
    in:
      command: cat
      data: hello
    type: Pipe
  Boom:
    in:
      command: 'sh -c "exit 3"'
      data: x
    type: Pipe
`
    );
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serialises stdin, runs the command, deserialises stdout', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Gen');
    expect(rt.readPort('cocoon://Gen/out/data')).toEqual([2, 4, 6]);
    expect(new Map(rt.snapshot()).get('Gen')!.status).toBe('done');
  });

  it('without serialise/deserialise it is plain string in/out', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Echo');
    expect(rt.readPort('cocoon://Echo/out/data')).toBe('hello');
  });

  it('a non-zero exit surfaces as a node error, not a plan abort', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await expect(rt.process('Boom')).rejects.toThrow(/Boom/);
    const st = new Map(rt.snapshot()).get('Boom')!;
    expect(st.status).toBe('error');
    expect(st.error).toMatch(/status 3/);
  });
});
