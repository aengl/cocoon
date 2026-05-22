/**
 * The optional, orthogonal client-presence side-channel (human↔AI collab;
 * also the substrate the deferred brushing & linking would ride). Three
 * layers:
 *   1. PresenceHub in isolation — set/clear/drop/cap/snapshot.
 *   2. serve.ts as a dumb relay — connect burst carries `clientId` + a
 *      `presence` frame; a peer's announce rebroadcasts to everyone;
 *      disconnect evaporates it.
 *   3. The agent surface end-to-end — `readPresence` + a blocking `suggest`
 *      resolved over the SAME channel by a stand-in "editor", incl. one real
 *      subprocess of the shipped cli.ts.
 */
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../protocol.ts';
import { PresenceHub } from '../../../core/presence.ts';
import { readPresence, suggest } from '../../../core/query-client.ts';
import { serve } from '../../../core/serve.ts';

const clab = fileURLToPath(
  new URL('./fixtures/clab/cocoon.yml', import.meta.url)
);
const cli = fileURLToPath(new URL('../../../core/cli.ts', import.meta.url));
const exec = promisify(execFile);

describe('PresenceHub', () => {
  it('set / snapshot / clear-null / drop', () => {
    const h = new PresenceHub();
    const a = h.newConnId();
    const b = h.newConnId();
    expect(a).not.toBe(b);
    expect(h.set(a, 'editor', { label: 'editor', openControls: ['X'] })).toBe(
      true
    );
    expect(h.set(b, 'claude', { label: 'claude' })).toBe(true);
    expect(h.snapshot().map(e => e.client).sort()).toEqual([
      'claude',
      'editor',
    ]);
    // null clears (go silent without disconnecting); only "was present" flips.
    expect(h.set(a, 'editor', null)).toBe(true);
    expect(h.set(a, 'editor', null)).toBe(false);
    expect(h.snapshot()).toHaveLength(1);
    expect(h.drop(b)).toBe(true);
    expect(h.drop(b)).toBe(false);
    expect(h.snapshot()).toHaveLength(0);
  });

  it('rejects an oversized blob (sanity rail, never fatal)', () => {
    const h = new PresenceHub();
    const c = h.newConnId();
    const huge = { label: 'x', blob: 'z'.repeat(300 * 1024) };
    expect(h.set(c, 'x', huge)).toBe(false);
    expect(h.snapshot()).toHaveLength(0); // unchanged — caller just no-ops
  });
});

describe('serve.ts presence relay', () => {
  let stop: () => void;
  let url: string;

  beforeAll(async () => {
    const { wss } = await serve(clab, 0);
    if (!wss.address()) await once(wss, 'listening');
    url = `ws://localhost:${(wss.address() as { port: number }).port}`;
    stop = () => wss.close();
  });
  afterAll(() => stop());

  const open = async () => {
    const ws = new WebSocket(url);
    const inbox: ServerMessage[] = [];
    ws.on('message', r => inbox.push(JSON.parse(String(r))));
    await once(ws, 'open');
    return { ws, inbox };
  };
  const waitUntil = (cond: () => boolean, label: string) =>
    new Promise<void>((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        if (cond()) return res();
        if (Date.now() - t0 > 2000) return rej(new Error(`timeout: ${label}`));
        setTimeout(tick, 10);
      };
      tick();
    });

  it('connect burst carries clientId + a presence frame', async () => {
    const { ws, inbox } = await open();
    await waitUntil(
      () => inbox.some(m => m.t === 'hello') && inbox.some(m => m.t === 'presence'),
      'hello+presence'
    );
    const hello = inbox.find(m => m.t === 'hello') as Extract<
      ServerMessage,
      { t: 'hello' }
    >;
    expect(typeof hello.clientId).toBe('string');
    expect(hello.clientId.length).toBeGreaterThan(0);
    ws.close();
  });

  it("relays selectedNodes (the human's canvas selection — the callout mirror)", async () => {
    const a = await open();
    const b = await open();
    await waitUntil(
      () => b.inbox.some(m => m.t === 'presence'),
      'b initial presence'
    );
    a.ws.send(
      JSON.stringify({
        t: 'presence',
        client: 'editor',
        data: {
          label: 'editor',
          selectedNodes: ['CrawlAmazon', 'CrawlAmazonMissing'],
        },
      })
    );
    await waitUntil(() => {
      const p = [...b.inbox].reverse().find(m => m.t === 'presence') as
        | Extract<ServerMessage, { t: 'presence' }>
        | undefined;
      const e = p?.clients.find(c => c.client === 'editor');
      return !!e && Array.isArray(e.data.selectedNodes);
    }, 'b sees selectedNodes');
    const seen = [...b.inbox].reverse().find(m => m.t === 'presence') as Extract<
      ServerMessage,
      { t: 'presence' }
    >;
    const editor = seen.clients.find(c => c.client === 'editor')!;
    expect(editor.data.selectedNodes).toEqual([
      'CrawlAmazon',
      'CrawlAmazonMissing',
    ]);
    a.ws.close();
    b.ws.close();
  });

  it("a peer's announce rebroadcasts to everyone; disconnect evaporates it", async () => {
    const a = await open();
    const b = await open();
    await waitUntil(
      () => b.inbox.some(m => m.t === 'presence'),
      'b initial presence'
    );

    a.ws.send(
      JSON.stringify({
        t: 'presence',
        client: 'editor',
        data: { label: 'editor', openControls: ['DescribeGames'] },
      })
    );
    await waitUntil(() => {
      const p = [...b.inbox].reverse().find(m => m.t === 'presence') as
        | Extract<ServerMessage, { t: 'presence' }>
        | undefined;
      return !!p?.clients.some(c => c.client === 'editor');
    }, 'b sees editor presence');

    const seen = [...b.inbox].reverse().find(m => m.t === 'presence') as Extract<
      ServerMessage,
      { t: 'presence' }
    >;
    const editor = seen.clients.find(c => c.client === 'editor')!;
    expect(editor.data.openControls).toEqual(['DescribeGames']);

    a.ws.close(); // disconnect → presence must evaporate + rebroadcast
    await waitUntil(() => {
      const p = [...b.inbox].reverse().find(m => m.t === 'presence') as
        | Extract<ServerMessage, { t: 'presence' }>
        | undefined;
      return !!p && !p.clients.some(c => c.client === 'editor');
    }, 'editor presence evaporated');
    b.ws.close();
  });
});

describe('agent surface: readPresence + blocking suggest', () => {
  let stop: () => void;
  let url: string;

  beforeAll(async () => {
    const { wss } = await serve(clab, 0);
    if (!wss.address()) await once(wss, 'listening');
    url = `ws://localhost:${(wss.address() as { port: number }).port}`;
    stop = () => wss.close();
  });
  afterAll(() => stop());

  /**
   * A stand-in editor: announces a draft, and auto-resolves any peer
   * change-set it sees over the same presence channel — exactly what the
   * real SuggestionToast Apply will do. Resolves only once the core has
   * echoed our own presence back (registered), so a subsequent
   * `readPresence`/`suggest` is race-free; `close()` awaits the real socket
   * close so a stale editor never answers the *next* test's change-set
   * (one shared core across the describe block).
   */
  async function fakeEditor(verdict: 'applied' | 'discarded' = 'applied') {
    const ws = new WebSocket(url);
    let me: string | undefined;
    let markReady: () => void;
    const ready = new Promise<void>(r => (markReady = r));
    // Attach BEFORE 'open' — the connect burst (hello/graph/snapshot/
    // presence) lands the instant the socket opens; an await-then-listen
    // shape drops `hello`, so the editor never announces (query-client.ts
    // documents this exact footgun).
    ws.on('message', raw => {
      const m = JSON.parse(String(raw)) as ServerMessage;
      if (m.t === 'hello') {
        me = m.clientId;
        ws.send(
          JSON.stringify({
            t: 'presence',
            client: 'editor',
            data: {
              label: 'editor',
              openControls: ['DescribeGames'],
              controlDrafts: {
                DescribeGames: { description: 'Die Macher ist ein Spiel.' },
              },
            },
          })
        );
      } else if (m.t === 'presence') {
        if (m.clients.some(c => c.id === me)) markReady(); // registered
        for (const c of m.clients) {
          if (c.id === me) continue;
          const cs = c.data?.changeSet;
          if (cs)
            ws.send(
              JSON.stringify({
                t: 'presence',
                client: 'editor',
                data: {
                  label: 'editor',
                  resolvedSuggestions: [{ id: cs.id, verdict }],
                },
              })
            );
        }
      }
    });
    await once(ws, 'open');
    await ready;
    return async () => {
      ws.close();
      await once(ws, 'close');
    };
  }

  it('readPresence sees the human draft (what is pasted in the box)', async () => {
    const close = await fakeEditor();
    try {
      const peers = await readPresence(url);
      const editor = peers.find(p => p.client === 'editor');
      expect(editor?.data.controlDrafts?.DescribeGames?.description).toMatch(
        /Die Macher/
      );
    } finally {
      await close();
    }
  }, 15000);

  it('suggest() blocks until the editor resolves it over the same channel', async () => {
    const close = await fakeEditor('applied');
    try {
      const r = await suggest(
        url,
        {
          id: 'sug-test-1',
          from: 'claude',
          edits: [
            {
              node: 'DescribeGames',
              field: 'description',
              value: 'The Kingmaker.',
            },
          ],
        },
        'claude',
        8000
      );
      expect(r).toEqual({ verdict: 'applied', by: 'editor' });
    } finally {
      await close();
    }
  }, 15000);

  it('the shipped cli.ts `suggest` resolves with the verdict (exit 0)', async () => {
    const close = await fakeEditor('discarded');
    try {
      const { stdout } = await exec(
        process.execPath,
        [
          cli,
          'suggest',
          '--core',
          url,
          '--timeout',
          '8000',
          'DescribeGames',
          'description',
          'The Kingmaker.',
        ],
        { timeout: 15_000 }
      );
      expect(JSON.parse(stdout).verdict).toBe('discarded');
    } finally {
      await close();
    }
  }, 30000);
});
