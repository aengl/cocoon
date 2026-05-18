/**
 * The standard front door: `cocoon query`/`reload` as a thin client to a
 * *running* core (not a fresh Runtime). Covers the client library against an
 * in-process served core, plus one real subprocess invocation of the shipped
 * `core/cli.ts` so the arg surface + exit codes are guarded end to end.
 */
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CoreUnreachable,
  sendProcess,
  sendQuery,
  sendReload,
  sendSetControl,
} from '../../../core/query-client.ts';
import type { Runtime } from '../../../core/runtime.ts';
import { serve } from '../../../core/serve.ts';

const clab = fileURLToPath(
  new URL('../../../../examples/clab/cocoon.yml', import.meta.url)
);
// The *fixed* clab (has the `Parse` Map, so `Cluster` actually clusters) —
// the broken `cocoon.yml` above errors on Cluster by design, so it can't
// exercise the steering happy path.
const clabFixed = fileURLToPath(
  new URL('../../../../examples/clab/cocoon.fixed.yml', import.meta.url)
);
const cli = fileURLToPath(new URL('../../../core/cli.ts', import.meta.url));
// async exec: a *sync* spawn would block this worker's event loop — which is
// also running the in-process core — and deadlock (server can't answer).
const exec = promisify(execFile);

describe('query-client against a running core', () => {
  let stop: () => void;
  let url: string;

  beforeAll(async () => {
    const { wss } = await serve(clab, 0);
    if (!wss.address()) await once(wss, 'listening');
    url = `ws://localhost:${(wss.address() as { port: number }).port}`;
    stop = () => wss.close();
  });
  afterAll(() => stop());

  it('sendQuery returns bounded data for a good query', async () => {
    const ov = (await sendQuery(url, { kind: 'overview' })) as {
      nodes: number;
    };
    expect(ov.nodes).toBe(3);
  });

  it('sendQuery rejects an ok:false result with the core error', async () => {
    await expect(
      sendQuery(url, { kind: 'node', id: 'Nope' })
    ).rejects.toThrow(/No such node "Nope"/);
  });

  it('sendReload reports the post-reload snapshot', async () => {
    const r = await sendReload(url);
    expect(r.nodes).toBe(3);
    expect(r.status).toEqual({ idle: 3 });
  });

  it('a dead core is a clean CoreUnreachable, not a hang', async () => {
    await expect(sendQuery('ws://localhost:1', { kind: 'overview' }, 2000))
      .rejects.toBeInstanceOf(CoreUnreachable);
  });

  it('the shipped cli.ts binary speaks to the running core', async () => {
    const { stdout } = await exec(
      process.execPath,
      [cli, 'query', '--core', url, 'overview'],
      { timeout: 15_000 }
    );
    expect(JSON.parse(stdout).nodes).toBe(3);
  });

  it('cli.ts exits 2 when no core is reachable', async () => {
    await expect(
      exec(
        process.execPath,
        [cli, 'query', '--core', 'ws://localhost:1', 'overview'],
        { timeout: 15_000 }
      )
    ).rejects.toMatchObject({ code: 2 });
  });
});

describe('set-control against a running core (the agent act surface)', () => {
  let stop: () => void;
  let url: string;
  let rt: Runtime;

  beforeAll(async () => {
    const served = await serve(clabFixed, 0);
    rt = served.rt;
    const { wss } = served;
    if (!wss.address()) await once(wss, 'listening');
    url = `ws://localhost:${(wss.address() as { port: number }).port}`;
    stop = () => wss.close();
    // Pull-resolve the KMeans schema (lazy, keystone 6) so setControl can
    // validate — and leave Cluster `done`, so the steer ages it `stale`.
    await rt.process('Cluster');
  });
  afterAll(() => stop());

  it('sendSetControl steers a resolved control and reads it back authoritatively', async () => {
    const r = await sendSetControl(url, 'Cluster', 'metric', 'manhattan');
    // Anchored on setControl's own re-broadcast (#2), never racing the
    // same-batch query against its post-await `set`.
    expect(r.controlState?.metric).toBe('manhattan');
    expect(r.status).toBe('stale'); // pure pull: aged, never re-run
  });

  it('a no-op write (bad key) falls back to the unchanged read-back', async () => {
    const r = await sendSetControl(url, 'Cluster', 'ghostKey', 1);
    // Validation no-op → no #2 broadcast; the parallel query is the fallback.
    expect(r.controlState).not.toHaveProperty('ghostKey');
    expect(r.controlState?.metric).toBeDefined();
  });

  it('the shipped cli.ts binary set-control round-trips the value', async () => {
    const { stdout } = await exec(
      process.execPath,
      [cli, 'set-control', '--core', url, 'Cluster', 'k', '4'],
      { timeout: 15_000 }
    );
    const out = JSON.parse(stdout);
    expect(out.controlState.k).toBe(4); // JSON-parsed from the string arg
    expect(out.status).toBe('stale');
  });

  it('cli.ts set-control exits non-zero on an unknown node', async () => {
    await expect(
      exec(
        process.execPath,
        [cli, 'set-control', '--core', url, 'Nope', 'k', '1'],
        { timeout: 15_000 }
      )
    ).rejects.toMatchObject({ code: 1 });
  });

  it('sendProcess runs a node on the *running* core (not headless) and settles on done', async () => {
    // `Cluster` was already pulled in beforeAll, so this is the "green
    // target re-runs" path: idle/done → queued → running → done. sendProcess
    // must ride that churn and resolve on the settled terminal state.
    const r = await sendProcess(url, 'Cluster');
    expect(r.status).toBe('done');
    expect(typeof r.summary).toBe('string');
  });

  it('the shipped cli.ts binary `process` drives the running core', async () => {
    const { stdout } = await exec(
      process.execPath,
      [cli, 'process', '--core', url, 'Cluster'],
      { timeout: 15_000 }
    );
    expect(JSON.parse(stdout).status).toBe('done');
  });
});
