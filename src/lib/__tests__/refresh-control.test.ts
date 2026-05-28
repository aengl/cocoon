/**
 * `cocoon refresh-control` — the out-of-band control re-derive.
 *
 * The contract under test (the agent's live-fill path for annotation-style
 * nodes): writing a node's OWN durable file directly and then firing
 * `refresh-control` re-derives `control.data` and re-streams `controlData` to
 * clients WITHOUT a pull — no `process()`, no graph aging, no status change.
 * Pull stays the sole compute trigger; this only refreshes presentation.
 *
 * It rides the core's reserved `$mount` control event (controls-render.ts),
 * so this also pins that `$mount` derives even on a never-pulled `idle` node.
 */
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '../../../core/serve.ts';
import { sendRefreshControl } from '../../../core/query-client.ts';

/**
 * A node whose free-form control's `data` half reads a sibling JSON file via
 * `ctx.resolvePath` — the annotation-workspace shape in miniature. `process`
 * writes nothing interesting; the point is the control, which is live against
 * the file independent of any pull.
 */
const FILE_CONTROL = `
import { promises as fs } from 'node:fs';
export const FileControl = {
  category: 'Test',
  async *process(ctx) {
    ctx.ports.write({ data: [] });
    return 'ok';
  },
  control: {
    async data(ctx) {
      const p = ctx.resolvePath('workspace.json');
      try {
        return JSON.parse(await fs.readFile(p, 'utf8'));
      } catch {
        return { v: 'missing' };
      }
    },
    render(ctx) {
      const d = (ctx.data ?? {});
      return '<div>v=' + (d.v ?? '?') + '</div>';
    },
  },
};
`;

/** A plain node with no `control` at all — refresh-control must be a safe
 *  no-op against it (controlData stays absent, no hang). */
const PLAIN = `
export const Plain = {
  category: 'Test',
  async *process(ctx) { ctx.ports.write({ data: [] }); return 'ok'; },
};
`;

const FLOW = [
  'nodes:',
  '  N:',
  '    type: FileControl',
  '  P:',
  '    type: Plain',
  '',
].join('\n');

function scaffold(initial: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'refresh-'));
  mkdirSync(path.join(dir, 'nodes'));
  writeFileSync(path.join(dir, 'nodes', 'FileControl.ts'), FILE_CONTROL);
  writeFileSync(path.join(dir, 'nodes', 'Plain.ts'), PLAIN);
  writeFileSync(path.join(dir, 'cocoon.yml'), FLOW);
  writeFileSync(
    path.join(dir, 'workspace.json'),
    JSON.stringify(initial),
    'utf8'
  );
  return dir;
}

describe('refresh-control — out-of-band control re-derive, no pull', () => {
  let dir: string;
  let url: string;
  let stop: () => void;

  beforeAll(async () => {
    dir = scaffold({ v: 1 });
    const { wss } = await serve(path.join(dir, 'cocoon.yml'), 0);
    if (!wss.address()) await once(wss, 'listening');
    stop = () => wss.close();
    url = `ws://localhost:${(wss.address() as { port: number }).port}`;
  });
  afterAll(() => {
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('derives controlData on a never-pulled idle node', async () => {
    const r = await sendRefreshControl(url, 'N');
    // No pull happened: the node is still idle, yet the control derived.
    expect(r.status).toBe('idle');
    expect(r.controlData).toEqual({ v: 1 });
  });

  it('re-reads the file after an EXTERNAL write (no control event)', async () => {
    // Simulate the agent writing the node's own durable file directly.
    writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({ v: 2 }));
    const r = await sendRefreshControl(url, 'N');
    expect(r.status).toBe('idle'); // still no pull / no graph aging
    expect(r.controlData).toEqual({ v: 2 });
  });

  it('is a safe no-op on a node with no free-form control', async () => {
    const r = await sendRefreshControl(url, 'P');
    expect(r.status).toBe('idle');
    expect(r.controlData).toBeUndefined();
  });
});
