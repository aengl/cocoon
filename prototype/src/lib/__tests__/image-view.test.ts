/**
 * The Image view + static `out:` port seeding (legacy `writeToPorts(node,
 * definition.out)` + `@cocoon/plugin-views` Image), proven through Runtime —
 * the missing display half of `examples/interop`'s `VisualiseInR`. Uses a
 * 1×1 PNG fixture and `Pipe`+`cat`, so the suite stays python/R-free.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

// Smallest valid PNG (1×1 transparent).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Image view + static out: seeding (interop VisualiseInR shape)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-img-'));

  beforeAll(() => {
    writeFileSync(path.join(dir, 'pic.png'), PNG_B64, 'base64');
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      `nodes:
  Plot:
    in:
      command: cat
      data: ignored-stdout
    out:
      src: pic.png
    type: Pipe
    view: Image
  Missing:
    in:
      command: cat
      data: x
    out:
      src: nope.png
    type: Pipe
    view: Image
`
    );
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('seeds out: literals onto ports (overriding/alongside node output)', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Plot');
    // Static literal seeded onto the `src` port verbatim (a path string).
    expect(rt.readPort('cocoon://Plot/out/src')).toBe('pic.png');
    // The node's own `data` output still there (cat echoed stdin).
    expect(rt.readPort('cocoon://Plot/out/data')).toBe('ignored-stdout');
  });

  it('bare `view: Image` binds to defaultPort `src`, file → data URI', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Plot');
    const st = new Map(rt.snapshot()).get('Plot')!;
    expect(st.status).toBe('done');
    expect(st.viewData).toEqual({
      src: `data:image/png;base64,${PNG_B64}`,
    });
  });

  it('a missing image serialises to null, not a crash', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Missing');
    const st = new Map(rt.snapshot()).get('Missing')!;
    expect(st.status).toBe('done');
    expect(st.viewData).toBeNull();
  });
});
