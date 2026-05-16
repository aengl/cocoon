/**
 * Out-of-band crash containment (core/node-guard.ts). The contract: a node
 * that throws with nothing awaiting it — the real case being `pg` throwing
 * "client password must be a string" from a TLS socket `data` handler — must
 * become *that node's* error, never a dead core.
 *
 * The integration cases spawn the real CLI (a child process, exactly the
 * user's scenario) so the would-be `uncaughtException` happens out-of-process
 * and can't trip vitest's own listeners. The discriminator is the message:
 * only if the throw was rerouted through node state → the plan does the
 * `Cannot process "<id>": …` wrapper appear; the unguarded bug would die at
 * the raw throw and never reach it. A small unit block covers the normal
 * pass-through (`guardNodeRun` must be transparent when nothing goes wrong).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guardNodeRun } from '../../../core/node-guard.ts';

const cli = fileURLToPath(new URL('../../../core/cli.ts', import.meta.url));

/** A throwaway project whose single node crashes out-of-band, run headless. */
function runCrashingNode(body: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-guard-'));
  try {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ cocoon: { nodes: ['boom.js'] } })
    );
    writeFileSync(
      path.join(dir, 'boom.js'),
      `exports.Boom = { async *process() {\n${body}\n` +
        `  await new Promise(r => setTimeout(r, 2000));\n` +
        `  yield 'unreachable';\n} };\n`
    );
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      'nodes:\n  Boom:\n    type: Boom\n'
    );
    return spawnSync(
      process.execPath,
      [cli, 'run', path.join(dir, 'cocoon.yml'), '--target', 'cocoon://Boom/out/data'],
      { encoding: 'utf8', timeout: 20_000 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('core survives out-of-band node crashes', () => {
  it('uncaughtException from a node → node failure, not a dead core', () => {
    const r = runCrashingNode(
      `  setImmediate(() => { throw new Error('out-of-band boom'); });`
    );
    const out = r.stdout + r.stderr;
    // Reached the plan's target-failure wrapper ⇒ the throw was rerouted onto
    // the node, not fatal. (Headless still exits non-zero for a failed target.)
    expect(out).toContain('Cannot process "Boom"');
    expect(out).toContain('out-of-band boom');
    expect(r.status).not.toBe(0);
    expect(r.signal).toBeNull(); // not SIGKILLed / not a hard V8 abort
  });

  it('unhandledRejection from a node → node failure, not a dead core', () => {
    const r = runCrashingNode(
      `  Promise.reject(new Error('orphan rejection'));`
    );
    const out = r.stdout + r.stderr;
    expect(out).toContain('Cannot process "Boom"');
    expect(out).toContain('orphan rejection');
    expect(r.status).not.toBe(0);
    expect(r.signal).toBeNull();
  });
});

describe('guardNodeRun is transparent on the happy path', () => {
  it('passes through the resolved value', async () => {
    await expect(guardNodeRun('ok', async () => 42)).resolves.toBe(42);
  });

  it('passes through a normal rejection (→ runOne catch as today)', async () => {
    await expect(
      guardNodeRun('bad', async () => {
        throw new Error('ordinary failure');
      })
    ).rejects.toThrow('ordinary failure');
  });
});
