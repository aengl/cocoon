/**
 * The chosen transport: the editor/AI shared WS core. Covers serve.ts's
 * serve-specific glue — `query`↔`queryResult` correlation by `rid`, the
 * read-only error path, and `reload` re-broadcasting graph + a fresh
 * snapshot to every client (the "fix it, watch it light up" loop). The
 * introspection *content* is covered by ai-session.test.ts.
 */
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../protocol.ts';
import { serve } from '../../../core/serve.ts';

const clab = fileURLToPath(
  new URL('./fixtures/clab/cocoon.yml', import.meta.url)
);

describe('serve.ts — shared WS core', () => {
  let stop: () => void;
  let url: string;
  let ws: WebSocket;
  const inbox: ServerMessage[] = [];

  /** Resolve once `cond()` holds over the accumulating inbox (or time out).
   *  Polling, so it can't miss messages that land between WS frames the way
   *  a one-shot 'message' listener resolving on the *first* match does. */
  const waitUntil = (cond: () => boolean, label = 'condition') =>
    new Promise<void>((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        if (cond()) return res();
        if (Date.now() - t0 > 2000) return rej(new Error(`timeout: ${label}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  const count = (t: ServerMessage['t']) =>
    inbox.filter(m => m.t === t).length;

  beforeAll(async () => {
    const { wss } = await serve(clab, 0);
    if (!wss.address()) await once(wss, 'listening');
    stop = () => wss.close();
    url = `ws://localhost:${(wss.address() as { port: number }).port}`;
    ws = new WebSocket(url);
    ws.on('message', raw => inbox.push(JSON.parse(String(raw))));
    await once(ws, 'open');
  });
  afterAll(() => {
    ws.close();
    stop();
  });

  const result = (rid: string) =>
    inbox.find(
      (m): m is Extract<ServerMessage, { t: 'queryResult' }> =>
        m.t === 'queryResult' && m.rid === rid
    );

  it('greets with hello + graph + the full node snapshot', async () => {
    await waitUntil(
      () => count('graph') === 1 && count('node') === 3,
      'hello+graph+snapshot'
    );
    expect(inbox.find(m => m.t === 'hello')).toBeTruthy();
  });

  it('answers a query correlated by rid', async () => {
    ws.send(JSON.stringify({ t: 'query', rid: 'a1', q: { kind: 'overview' } }));
    await waitUntil(() => !!result('a1'), 'queryResult a1');
    const r = result('a1')!;
    expect(r.ok).toBe(true);
    expect((r.data as { nodes: number }).nodes).toBe(3);
  });

  it('reports a bad query as ok:false, not a crash', async () => {
    ws.send(
      JSON.stringify({ t: 'query', rid: 'b2', q: { kind: 'node', id: 'Nope' } })
    );
    await waitUntil(() => !!result('b2'), 'queryResult b2');
    const r = result('b2')!;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No such node "Nope"/);
  });

  it('reload re-broadcasts graph + a fresh snapshot to the client', async () => {
    inbox.length = 0;
    ws.send(JSON.stringify({ t: 'reload' }));
    await waitUntil(
      () => count('graph') === 1 && count('node') === 3,
      'reload rebroadcast'
    );
    const nodes = inbox.filter(
      (m): m is Extract<ServerMessage, { t: 'node' }> => m.t === 'node'
    );
    expect(nodes.every(n => n.state.status === 'idle')).toBe(true);
  });
});
