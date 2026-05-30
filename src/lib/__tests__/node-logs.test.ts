/**
 * Per-node `ctx.debug()` capture. `debug` no longer just hits the core's
 * stderr (which neither the editor nor the agent can read) — it appends to a
 * bounded, per-run ring buffer surfaced over the wire via `query logs` / the
 * `logCount`+`logTail` on `query node` / the aggregate `logLines` on
 * `overview`. Exercised through the real `Runtime` + introspect layer.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../core/runtime.ts';
import { nodeDetail, overview } from '../../../core/introspect.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-logs-'));
const nodes = path.join(dir, 'nodes');
mkdirSync(nodes, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const node = (name: string, body: string) =>
  writeFileSync(
    path.join(nodes, `${name}.ts`),
    `export const ${name} = { async *process(ctx) {\n${body}\n} };\n`
  );

// Logs twice (a string and a string+object), writes once. The object proves
// console-style formatting (util.format) reaches the buffer.
node(
  'Talker',
  `ctx.debug('starting up');
   ctx.debug('saw', { n: 3 });
   ctx.ports.write({ out: [1, 2, 3] });
   return 'done';`
);
// Never logs — its buffer stays empty.
node('Quiet', `ctx.ports.write({ out: [1] }); return 'quiet';`);

writeFileSync(
  path.join(dir, 'cocoon.yml'),
  `nodes:
  Talker: { type: Talker }
  Quiet: { type: Quiet }
`
);

describe('per-node ctx.debug capture', () => {
  it('buffers debug lines and serves them via logsOf', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Talker');

    const logs = rt.logsOf('Talker');
    expect(logs.count).toBe(2);
    expect(logs.lines.map(l => l.text)).toEqual([
      'starting up',
      'saw { n: 3 }',
    ]);
    // ms is a run-relative offset, present and non-negative.
    expect(logs.lines.every(l => typeof l.ms === 'number' && l.ms >= 0)).toBe(
      true
    );
  });

  it('--limit returns the newest N, count stays the full length', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Talker');
    const tail = rt.logsOf('Talker', 1);
    expect(tail.count).toBe(2);
    expect(tail.lines.map(l => l.text)).toEqual(['saw { n: 3 }']);
  });

  it('resets the buffer on re-run (per-run, not cumulative)', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Talker');
    await rt.process('Talker');
    expect(rt.logsOf('Talker').count).toBe(2);
  });

  it('surfaces count + tail on query node, aggregate on overview', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Talker');

    const detail = nodeDetail(rt, 'Talker') as {
      logCount?: number;
      logTail?: { ms: number; text: string }[];
    };
    expect(detail.logCount).toBe(2);
    expect(detail.logTail?.map(l => l.text)).toEqual([
      'starting up',
      'saw { n: 3 }',
    ]);

    expect((overview(rt) as { logLines?: number }).logLines).toBe(2);
  });

  it('a node that never logs has no buffer noise', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Quiet');

    expect(rt.logCountOf('Quiet')).toBe(0);
    const detail = nodeDetail(rt, 'Quiet') as {
      logCount?: number;
      logTail?: unknown;
    };
    expect(detail.logCount).toBeUndefined();
    expect(detail.logTail).toBeUndefined();
    // No node logged ⇒ overview omits the aggregate entirely.
    expect((overview(rt) as { logLines?: number }).logLines).toBeUndefined();
  });

  it('invalidate drops the buffer', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Talker');
    expect(rt.logCountOf('Talker')).toBe(2);
    await rt.invalidate('Talker');
    expect(rt.logCountOf('Talker')).toBe(0);
  });

  it('folds browser control-hook logs into the same buffer', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));
    await rt.process('Talker');
    expect(rt.logCountOf('Talker')).toBe(2);

    // A hook threw in the browser between pulls; the editor forwards it over
    // the WS, the core folds it into the node's own buffer (tagged `[hook]`).
    rt.appendControlLog('Talker', 'error', 'TypeError: boom\n  at mount');
    const { count, lines } = rt.logsOf('Talker');
    expect(count).toBe(3);
    expect(lines[2].text).toContain('[hook:error]');
    expect(lines[2].text).toContain('boom');

    // `log` level is untagged-by-severity; unknown node is a silent no-op.
    rt.appendControlLog('Talker', 'log', 'just chatter');
    expect(rt.logsOf('Talker').lines[3].text).toBe('[hook] just chatter');
    expect(() => rt.appendControlLog('ghost', 'error', 'x')).not.toThrow();
  });
});
