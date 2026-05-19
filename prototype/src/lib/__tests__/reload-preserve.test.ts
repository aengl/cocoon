/**
 * Selective reload (keystone-6 refinement). Editing cocoon.yml must NOT wipe
 * every computed result — a node keeps its output iff its own compute
 * signature AND entire transitive upstream are unchanged; the structural
 * delta is treated exactly as the pull graph treats an upstream re-run.
 *
 * Conservative by construction: a false reset only costs a re-pull; a false
 * preserve would show stale data as fresh. These tests pin both the "keep
 * what's provably unchanged" win AND the negatives that MUST reset — incl.
 * the silent-corruption guard (a changed persisted node must not be
 * re-hydrated from its stale-def cache). Throwaway temp flows; never the
 * canonical fixtures.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';

const V1 = `nodes:
  Root:
    type: ReadJSON
    in:
      uri: data.json
  Mid:
    type: Map
    in:
      data: cocoon://Root/out/data
  Leaf:
    type: Map
    in:
      data: cocoon://Mid/out/data
`;

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** A fresh temp flow + data.json; returns the cocoon.yml path. */
async function flow(yaml = V1): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cocoon-reload-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'data.json'), '[{"id":1},{"id":2},{"id":3}]');
  await writeFile(path.join(dir, 'data2.json'), '[{"id":9}]');
  const f = path.join(dir, 'cocoon.yml');
  await writeFile(f, yaml);
  return f;
}
const st = (rt: Runtime) => Object.fromEntries(rt.snapshot());
/** A node that kept a usable result: done/stale with non-empty ports. */
const live = (s: { status: string; ports: Record<string, number> }) =>
  (s.status === 'done' || s.status === 'stale') && (s.ports.data ?? 0) > 0;

describe('Runtime.reload — selective state preservation', () => {
  it('preserves unrelated, resets the changed node, stales its downstream', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');
    expect(['Root', 'Mid', 'Leaf'].every(id => st(rt)[id].status === 'done')).toBe(
      true
    );

    // Mid's own def changes (a literal param appears) → Mid resets; Root is
    // upstream & untouched → preserved; Leaf is unchanged but fed by a
    // changed node → stale, last output kept visible.
    await writeFile(
      f,
      V1.replace(
        '      data: cocoon://Root/out/data\n',
        '      data: cocoon://Root/out/data\n      map: "x => x"\n'
      )
    );
    await rt.reload();
    const s = st(rt);
    expect(s.Root.status).toBe('done');
    expect(s.Root.ports.data).toBe(3); // output kept
    expect(s.Mid.status).toBe('idle'); // changed → reset
    expect(s.Mid.ports.data ?? 0).toBe(0); // store dropped
    expect(s.Leaf.status).toBe('stale'); // input moved
    expect(s.Leaf.ports.data).toBe(3); // but still visible (amber)
  });

  it('an editor-only / comment / pass-through-key edit preserves EVERYTHING', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');

    // Only non-compute keys move: position, a comment, and an arbitrary
    // unknown pass-through key (legacy `view:` — the View subsystem is gone,
    // but the key still round-trips losslessly and is excluded from the
    // compute signature). Nothing may reset or stale.
    await writeFile(
      f,
      '# a hand comment\n' +
        V1.replace(
          '  Mid:\n    type: Map\n',
          '  Mid:\n    type: Map\n    editor:\n      col: 7\n      row: 3\n    view: Inspector\n'
        )
    );
    await rt.reload();
    const s = st(rt);
    expect(['Root', 'Mid', 'Leaf'].every(id => s[id].status === 'done')).toBe(
      true
    );
    expect(['Root', 'Mid', 'Leaf'].every(id => s[id].ports.data === 3)).toBe(
      true
    );
  });

  it('an added downstream node leaves existing results untouched (the reported case)', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');

    await writeFile(
      f,
      V1 +
        '  Tail:\n    type: Map\n    in:\n      data: cocoon://Leaf/out/data\n'
    );
    await rt.reload();
    const s = st(rt);
    expect(['Root', 'Mid', 'Leaf'].every(id => live(s[id]))).toBe(true);
    expect(s.Tail.status).toBe('idle'); // brand new
  });

  it('a literal-config change resets that node and stales everything below it', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');

    await writeFile(f, V1.replace('uri: data.json', 'uri: data2.json'));
    await rt.reload();
    const s = st(rt);
    expect(s.Root.status).toBe('idle'); // its own config changed
    expect(s.Mid.status).toBe('stale'); // upstream moved, self unchanged
    expect(s.Leaf.status).toBe('stale');
    expect(s.Mid.ports.data).toBe(3); // last result still visible
  });

  it('a removed node is purged; its surviving upstream is preserved', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');

    await writeFile(
      f,
      'nodes:\n  Root:\n    type: ReadJSON\n    in:\n      uri: data.json\n' +
        '  Mid:\n    type: Map\n    in:\n      data: cocoon://Root/out/data\n'
    );
    await rt.reload();
    const s = st(rt);
    expect(s.Leaf).toBeUndefined(); // gone from the snapshot entirely
    expect(s.Root.status).toBe('done');
    expect(s.Mid.status).toBe('done');
  });

  it('a CHANGED persisted node is NOT re-hydrated from its stale-def cache', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');
    // Persist Mid: writes _cocoon_cache/Mid.json from its current output.
    await rt.setPersist('Mid', true);
    expect(st(rt).Mid.status).toBe('done');

    // Now Mid's definition changes. Its on-disk cache is from the OLD def;
    // hydrate() restores at load, so the cache MUST be dropped or Mid would
    // silently come back `done` with stale-def data.
    await writeFile(
      f,
      V1.replace(
        '      data: cocoon://Root/out/data\n',
        '      data: cocoon://Root/out/data\n      map: "x => x"\n'
      )
    );
    await rt.reload();
    await rt.whenHydrated(); // let the background restore attempt run
    const s = st(rt);
    expect(s.Mid.status).toBe('idle'); // reset, NOT restored from cache
    expect(s.Mid.ports.data ?? 0).toBe(0);
    expect(s.Root.status).toBe('done'); // unchanged upstream still preserved
  });

  it('a nodeDirs/env change falls back to the proven full reset', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');
    expect(st(rt).Root.status).toBe('done');

    // A top-level env change can shift every node's environment → not safely
    // diffable; everything returns to idle (the conservative fallback).
    await writeFile(f, 'env:\n  FOO: bar\n' + V1);
    await rt.reload();
    const s = st(rt);
    expect(['Root', 'Mid', 'Leaf'].every(id => s[id].status === 'idle')).toBe(
      true
    );
  });

  // Regression: the editor toolbar ↻ is a deliberate, user-initiated "recompute
  // everything". The keystone-6 selective path is the per-save *watcher*
  // concern only; an explicit reload on an UNCHANGED file must still go green
  // -> idle (12c90d9 collapsed both onto one selective path and silently broke
  // the button — its tooltip still promised "full reset").
  it('reload() is selective on an unchanged file; fullReset wipes everything', async () => {
    const f = await flow();
    const rt = await Runtime.load(f);
    await rt.process('Leaf');
    const allDone = () =>
      ['Root', 'Mid', 'Leaf'].every(id => st(rt)[id].status === 'done');
    expect(allDone()).toBe(true);

    // Default (watcher / `cocoon reload`): file unchanged → nothing resets.
    await rt.reload();
    expect(allDone()).toBe(true);

    // Explicit toolbar ↻ → full reset regardless of the (empty) diff.
    await rt.reload({ fullReset: true });
    expect(['Root', 'Mid', 'Leaf'].every(id => st(rt)[id].status === 'idle')).toBe(
      true
    );
  });
});
