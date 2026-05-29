/**
 * `cocoon control-event` — headless delivery of a free-form control event.
 *
 * The contract under test (the agent-as-peer write half): firing
 * `control-event <node> <event> --json <payload>` invokes the node's
 * `control.event(ctx, { event, payload })` handler exactly as a UI client's
 * shim does, then re-derives `control.data` and re-streams `controlData`.
 * Whether the graph ages is the HANDLER's call: a handler that runs
 * `ctx.markStale()` ages the node; one that doesn't is pure presentation.
 * No new capability surface — it only fires events the node already handles.
 *
 * Shares its client path with `refresh-control` (both = `sendControlEvent`);
 * the `$mount` sugar stays covered by refresh-control.test.ts.
 */
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '../../../core/serve.ts';
import { sendControlEvent, sendProcess } from '../../../core/query-client.ts';

/**
 * A node whose control owns a durable file (the annotation-workspace shape).
 * `set_v` writes the file from its payload — pure view mutation, no stale.
 * `commit` calls `ctx.markStale()` — the one output-affecting event. `data`
 * re-reads the file every derive, so `controlData` reflects each write.
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
    async event(ctx, { event, payload }) {
      if (event === 'set_v') {
        const p = ctx.resolvePath('workspace.json');
        await fs.writeFile(p, JSON.stringify({ v: payload.v }), 'utf8');
        return;
      }
      if (event === 'commit') {
        ctx.markStale();
        return;
      }
      // unknown event: do nothing (the no-op contract)
    },
  },
};
`;

const FLOW = ['nodes:', '  N:', '    type: FileControl', ''].join('\n');

function scaffold(initial: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'control-event-'));
  mkdirSync(path.join(dir, 'nodes'));
  writeFileSync(path.join(dir, 'nodes', 'FileControl.ts'), FILE_CONTROL);
  writeFileSync(path.join(dir, 'cocoon.yml'), FLOW);
  writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(initial));
  return dir;
}

describe('control-event — headless free-form event delivery', () => {
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

  it('invokes the handler with the payload and re-derives controlData', async () => {
    const r = await sendControlEvent(url, 'N', 'set_v', { v: 42 });
    // The handler wrote the durable file…
    expect(JSON.parse(readFileSync(path.join(dir, 'workspace.json'), 'utf8'))).toEqual({
      v: 42,
    });
    // …and the re-derived control reflects it, with no pull (still idle).
    expect(r.status).toBe('idle');
    expect(r.controlData).toEqual({ v: 42 });
  });

  it('a non-stale event leaves a done node done (pure presentation)', async () => {
    await sendProcess(url, 'N');
    const r = await sendControlEvent(url, 'N', 'set_v', { v: 7 });
    expect(r.status).toBe('done'); // handler didn't markStale
    expect(r.controlData).toEqual({ v: 7 });
  });

  it('a markStale handler ages a done node to stale', async () => {
    await sendProcess(url, 'N'); // back to done
    const r = await sendControlEvent(url, 'N', 'commit');
    expect(r.status).toBe('stale'); // handler called ctx.markStale()
  });

  it('an unhandled event is a safe no-op (still re-derives the view)', async () => {
    await sendProcess(url, 'N'); // done
    const r = await sendControlEvent(url, 'N', 'no_such_event');
    expect(r.status).toBe('done'); // unchanged
    expect(r.controlData).toEqual({ v: 7 }); // last written value
  });
});
