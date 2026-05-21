/**
 * The flow-file watcher (serve.ts). Editing cocoon.yml in a side-by-side
 * text editor must repaint every client WITHOUT an explicit `cocoon reload`
 * — the legacy auto-reload, restored. This is the *wiring* watcher; it is
 * deliberately distinct from keystone-6's pull-triggered node-*module* hot
 * reload (which has no watcher by design). Uses a throwaway temp flow so the
 * canonical `examples/*` fixtures are never mutated.
 */
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../protocol.ts';
import { serve } from '../../../core/serve.ts';

const ONE = `nodes:
  A:
    type: ReadJSON
    in:
      path: a.json
`;
const TWO = `nodes:
  A:
    type: ReadJSON
    in:
      path: a.json
  B:
    type: Map
    in:
      data: cocoon://A/out/data
`;

describe('serve.ts — flow-file watcher', () => {
  let dir: string;
  let file: string;
  let stop: () => void;
  let ws: WebSocket;
  const inbox: ServerMessage[] = [];

  const waitUntil = (cond: () => boolean, label = 'condition', budget = 8000) =>
    new Promise<void>((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        if (cond()) return res();
        if (Date.now() - t0 > budget) return rej(new Error(`timeout: ${label}`));
        setTimeout(tick, 15);
      };
      tick();
    });
  const graphs = () =>
    inbox.filter(
      (m): m is Extract<ServerMessage, { t: 'graph' }> => m.t === 'graph'
    );

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cocoon-watch-'));
    file = path.join(dir, 'cocoon.yml');
    await writeFile(file, ONE);
    const { wss } = await serve(file, 0);
    if (!wss.address()) await once(wss, 'listening');
    stop = () => wss.close();
    ws = new WebSocket(
      `ws://localhost:${(wss.address() as { port: number }).port}`
    );
    ws.on('message', raw => inbox.push(JSON.parse(String(raw))));
    await once(ws, 'open');
    // Drain the greeting (hello + initial graph + idle snapshot).
    await waitUntil(() => graphs().length === 1, 'initial graph');
  });
  afterAll(async () => {
    ws.close();
    stop(); // wss 'close' tears the watcher down (no leaked poll timer)
    await rm(dir, { recursive: true, force: true });
  });

  it('rebroadcasts the graph when the file changes on disk', async () => {
    inbox.length = 0;
    // A plain external edit — no `{t:'reload'}` is ever sent.
    await writeFile(file, TWO);
    await waitUntil(
      () => graphs().some(g => /\bB:/.test(g.yaml)),
      'watcher-driven rebroadcast'
    );
    const latest = graphs().at(-1)!;
    expect(latest.yaml).toContain('cocoon://A/out/data');
    // The fresh snapshot rides along too, so the editor repaints fully.
    expect(inbox.some(m => m.t === 'node')).toBe(true);
  });

  it('coalesces a burst of writes into a single reload', async () => {
    inbox.length = 0;
    // Three rapid saves inside one debounce window → one rebroadcast.
    await writeFile(file, ONE);
    await writeFile(file, TWO);
    await writeFile(file, ONE);
    await waitUntil(
      () => graphs().length >= 1,
      'debounced rebroadcast',
      8000
    );
    // Settle past the debounce + a couple of poll intervals, then assert the
    // burst didn't fan out into a rebroadcast per write.
    await new Promise(r => setTimeout(r, 1200));
    expect(graphs().length).toBe(1);
    expect(graphs()[0].yaml).not.toMatch(/\bB:/); // last write (ONE) won
  });
});
