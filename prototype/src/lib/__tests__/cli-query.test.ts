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
  sendQuery,
  sendReload,
} from '../../../core/query-client.ts';
import { serve } from '../../../core/serve.ts';

const clab = fileURLToPath(
  new URL('../../../../examples/clab/cocoon.yml', import.meta.url)
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
