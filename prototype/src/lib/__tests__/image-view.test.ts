/**
 * The migrated `Image` node (keystone 2/5 — the legacy `@cocoon/plugin-views`
 * Image as a render-only control: a `<img>` is inert HTML, so it needs no
 * browser hook at all, the sharpest proof that a visualisation is just a
 * control with a render and no `event`). Plus static `out:` port seeding
 * (legacy `writeToPorts(node, definition.out)` — a generic grammar feature,
 * unrelated to views, that the migration deliberately keeps). The missing
 * display half of `examples/interop`'s `VisualiseInR`. Uses a 1×1 PNG
 * fixture + `Pipe`/`cat`, so the suite stays python/R-free.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

// Smallest valid PNG (1×1 transparent).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Image node + static out: seeding (interop VisualiseInR shape)', () => {
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
  Pic:
    in:
      path: pic.png
    type: Image
  Missing:
    in:
      path: nope.png
    type: Image
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

  it('Image control.data reads the file → a data URI (streamed controlData)', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Pic');
    const st = new Map(rt.snapshot()).get('Pic')!;
    expect(st.status).toBe('done');
    expect(st.controlData).toEqual({
      ready: true,
      src: `data:image/png;base64,${PNG_B64}`,
    });
  });

  it('a missing image is not-ready, not a crash', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Missing');
    const st = new Map(rt.snapshot()).get('Missing')!;
    expect(st.status).toBe('done');
    expect(st.controlData).toEqual({ ready: false, src: '' });
  });
});
