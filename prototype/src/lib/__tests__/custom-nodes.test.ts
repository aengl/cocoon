/**
 * Project-local custom-node loading (the legacy `package.json` →
 * `cocoon.nodes` contract). Exercised against the real canonical examples so
 * it guards genuine backwards compatibility, plus a synthetic project for the
 * non-fatal failure path and its wiring into Runtime's error surface.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { registry as builtins } from '../../../core/nodes/index.ts';
import { loadProjectNodes } from '../../../core/load-nodes.ts';
import { Runtime } from '../../../core/runtime.ts';

const example = (name: string) =>
  fileURLToPath(
    new URL(`../../../../examples/${name}/cocoon.yml`, import.meta.url)
  );

describe('loadProjectNodes', () => {
  it('loads a project-local CJS node (noise → Circle), built-ins intact', async () => {
    const { registry, errors } = await loadProjectNodes(
      example('noise'),
      builtins
    );
    expect(errors.size).toBe(0);
    // Built-ins still present and untouched (project merged *over* a copy).
    for (const k of Object.keys(builtins)) expect(registry[k]).toBe(builtins[k]);
    // The custom type — keyed by the *export name*, not the filename.
    expect(typeof registry.Circle?.process).toBe('function');

    // And it actually runs: circle.js writes 100 {x,y} points.
    let written: Record<string, unknown> = {};
    const ctx = {
      ports: { read: () => ({}), write: (d: Record<string, unknown>) => (written = d) },
      debug: () => {},
      cocoonFilePath: example('noise'),
      nodeId: 'Circle',
    };
    for await (const _ of registry.Circle.process(ctx as never));
    expect((written.data as unknown[]).length).toBe(100);
  });

  it('is a no-op (no errors) when the project has no cocoon.nodes', async () => {
    const before = { ...builtins };
    const { registry, errors } = await loadProjectNodes(
      example('simple-api'),
      builtins
    );
    expect(errors.size).toBe(0);
    expect(Object.keys(registry).sort()).toEqual(Object.keys(before).sort());
    expect(builtins).toEqual(before); // base never mutated
  });

  it('loads zero-dep ExampleNode; Wikipedia is the only (deferred) failure', async () => {
    // ExampleNode was de-lodash'd to zero-dep, so it loads with nothing
    // installed. Wikipedia stays deferred (needs lodash/got + the temp-node
    // `processTemporaryNode` + the `Distance` npm-plugin — see CLAUDE.md):
    // its module fails to import and is skipped non-fatally, not crashing
    // the graph or the other custom node.
    const { registry, errors } = await loadProjectNodes(
      example('custom-nodes'),
      builtins
    );
    expect([...errors.keys()]).toEqual(['nodes/Wikipedia']);
    expect([...errors.values()][0]).toMatch(/lodash|got/);
    expect(registry.Wikipedia).toBeUndefined();
    expect(registry.ReadJSON).toBe(builtins.ReadJSON); // built-ins survive

    // ExampleNode loaded and actually runs with zero deps installed.
    expect(typeof registry.ExampleNode?.process).toBe('function');
    let written: Record<string, unknown> = {};
    const ctx = {
      ports: {
        read: () => ({ data: [{ t: 1 }, { t: 2 }, { t: 3 }] }),
        write: (d: Record<string, unknown>) => (written = d),
      },
      debug: () => {},
      cocoonFilePath: example('custom-nodes'),
      nodeId: 'ExampleNode',
    };
    for await (const _ of registry.ExampleNode.process(ctx as never));
    expect([{ t: 1 }, { t: 2 }, { t: 3 }]).toContainEqual(written.item);
  });
});

describe('Runtime surfaces custom-node load failures', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-cn-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reports the import reason on the dependent node, not a bare "unknown type"', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ cocoon: { nodes: ['broken.js'] } })
    );
    writeFileSync(path.join(dir, 'broken.js'), `require('totally-not-real');\n`);
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      'nodes:\n  N:\n    type: Custom\n'
    );

    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    // `process()` throws for a failed *target* (the documented contract that
    // gives `cocoon run` its non-zero exit) — the node state is set first.
    await expect(rt.process('N')).rejects.toThrow(/Unknown node type "Custom"/);

    const state = new Map(rt.snapshot()).get('N')!;
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/Unknown node type "Custom"/);
    expect(state.error).toMatch(/custom node module\(s\) failed to load/);
    expect(state.error).toMatch(/broken\.js/);
  });
});
