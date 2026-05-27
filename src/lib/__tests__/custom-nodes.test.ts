/**
 * Convention-based node resolution (keystone 6: no registry map, no
 * `package.json` — `type: X` → `X.{ts,js}` across core / yaml-adjacent
 * `nodes/` / declared `nodeDirs`, mtime-hot-reloaded, collisions fatal).
 * Exercised against the real canonical examples so it guards genuine
 * backwards compatibility, plus synthetic projects for collision, the
 * non-fatal failed-import path, mtime hot-reload, and the Runtime surface.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { CocoonProcessNode } from '../../../core/contract.ts';
import { NodeResolver } from '../../../core/resolve-nodes.ts';
import { Runtime } from '../../../core/runtime.ts';

const example = (name: string) =>
  fileURLToPath(
    new URL(`./fixtures/${name}/cocoon.yml`, import.meta.url)
  );

async function runWrite(
  node: CocoonProcessNode,
  ports: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let written: Record<string, unknown> = {};
  const ctx = {
    ports: {
      read: () => ports,
      write: (d: Record<string, unknown>) => (written = d),
    },
    debug: () => {},
    cocoonFilePath: '',
    nodeId: 'x',
  };
  for await (const _ of node.process(ctx as never));
  return written;
}

async function runSummary(node: CocoonProcessNode): Promise<string> {
  const it = node.process({
    ports: { read: () => ({}), write: () => {} },
    debug: () => {},
    cocoonFilePath: '',
    nodeId: 'x',
  } as never);
  let r = await it.next();
  while (!r.done) r = await it.next();
  return String(r.value ?? '').trim();
}

describe('NodeResolver — canonical examples', () => {
  it('resolves a project-local CJS node by filename', async () => {
    const r = new NodeResolver({ cocoonFilePath: example('noise') });

    // noise/nodes/Circle.js — keyed by filename === type, exported via CJS.
    const circle = await r.resolve('Circle');
    expect(circle.error).toBeUndefined();
    expect(typeof circle.node?.process).toBe('function');
    const out = await runWrite(circle.node!, {});
    expect((out.data as unknown[]).length).toBe(100);

    // Core ships zero built-in nodes (the function-library cut). A type with
    // no sibling `nodes/` file and no `nodeDirs:` source is just unknown —
    // the case previously satisfied by "Filter is a built-in".
    const unknown = await r.resolve('Filter');
    expect(unknown.node).toBeUndefined();
    expect(unknown.error).toMatch(/Unknown node type "Filter"/);
  });

  it('an unknown type is an error, not a throw', async () => {
    const r = new NodeResolver({ cocoonFilePath: example('simple-api') });
    const res = await r.resolve('NoSuchNode');
    expect(res.node).toBeUndefined();
    expect(res.error).toMatch(/Unknown node type "NoSuchNode"/);
  });

  it('zero-dep ExampleNode resolves; Wikipedia is a non-fatal failed import', async () => {
    const r = new NodeResolver({ cocoonFilePath: example('custom-nodes') });

    const ex = await r.resolve('ExampleNode');
    expect(ex.error).toBeUndefined();
    const out = await runWrite(ex.node!, { data: [{ t: 1 }, { t: 2 }, { t: 3 }] });
    expect([{ t: 1 }, { t: 2 }, { t: 3 }]).toContainEqual(out.item);

    // Wikipedia needs lodash/got (not installed): its module fails to import
    // — surfaced as that node's error only, ExampleNode unaffected.
    const wiki = await r.resolve('Wikipedia');
    expect(wiki.node).toBeUndefined();
    expect(wiki.error).toMatch(/Wikipedia.*failed to load/);
    expect(wiki.error).toMatch(/lodash|got/);
  });
});

describe('NodeResolver — collisions & pull-triggered hot reload', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-res-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a type defined in two roots is a categorical hard error', async () => {
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      'nodeDirs: [extra]\nnodes:\n  N:\n    type: Dup\n'
    );
    for (const root of ['nodes', 'extra']) {
      mkdirSync(path.join(dir, root), { recursive: true });
      writeFileSync(
        path.join(dir, root, 'Dup.ts'),
        `export const Dup = { async *process() { return '${root}'; } };\n`
      );
    }
    const r = new NodeResolver({
      cocoonFilePath: path.join(dir, 'cocoon.yml'),
      nodeDirs: ['extra'],
    });
    const res = await r.resolve('Dup');
    expect(res.node).toBeUndefined();
    expect(res.error).toMatch(/defined in multiple locations/);
  });

  it('re-imports a node module when its file mtime changes', async () => {
    const file = path.join(dir, 'nodes', 'Hot.ts');
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      'nodes:\n  N:\n    type: Hot\n'
    );
    writeFileSync(
      file,
      `export const Hot = { async *process() { return 'v1'; } };\n`
    );
    const r = new NodeResolver({ cocoonFilePath: path.join(dir, 'cocoon.yml') });

    const v1 = await r.resolve('Hot');
    expect(await runSummary(v1.node!)).toBe('v1');

    writeFileSync(
      file,
      `export const Hot = { async *process() { return 'v2'; } };\n`
    );
    // Guarantee a distinct mtime even on coarse/fast filesystems.
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);

    const v2 = await r.resolve('Hot');
    expect(await runSummary(v2.node!)).toBe('v2');
  });

  it('a fresh resolver re-imports an edited module (reload survives Node\'s URL cache)', async () => {
    // Runtime.reload() builds a new NodeResolver, dropping modCache. Without
    // the always-on `?m=<mtime>` cache-bust, the new resolver's first import
    // would use the bare URL and Node's process-wide ESM cache would hand
    // back the prior resolver's stale module — the bug behind the "hot-swap
    // doesn't pick up edits until I kill the serve" reports.
    const file = path.join(dir, 'nodes', 'Reload.ts');
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      'nodes:\n  N:\n    type: Reload\n'
    );
    writeFileSync(
      file,
      `export const Reload = { async *process() { return 'before'; } };\n`
    );
    const a = new NodeResolver({ cocoonFilePath: path.join(dir, 'cocoon.yml') });
    const v1 = await a.resolve('Reload');
    expect(await runSummary(v1.node!)).toBe('before');

    writeFileSync(
      file,
      `export const Reload = { async *process() { return 'after'; } };\n`
    );
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);

    const b = new NodeResolver({ cocoonFilePath: path.join(dir, 'cocoon.yml') });
    const v2 = await b.resolve('Reload');
    expect(await runSummary(v2.node!)).toBe('after');
  });
});

describe('Runtime surfaces node-resolution failures', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-cn-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reports the import reason on the dependent node, not a bare "unknown type"', async () => {
    mkdirSync(path.join(dir, 'nodes'), { recursive: true });
    writeFileSync(
      path.join(dir, 'nodes', 'Custom.ts'),
      `import 'totally-not-real';\nexport const Custom = { async *process() {} };\n`
    );
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      'nodes:\n  N:\n    type: Custom\n'
    );

    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    // `process()` throws for a failed *target* (the documented contract that
    // gives `cocoon run` its non-zero exit) — the node state is set first.
    await expect(rt.process('N')).rejects.toThrow(/Custom/);

    const state = new Map(rt.snapshot()).get('N')!;
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/Node type "Custom" failed to load/);
    expect(state.error).toMatch(/totally-not-real/);
    // Surfaced lazily into the AI digest's loadErrors.
    expect([...rt.loadErrors.keys()]).toContain('Custom');
  });
});
