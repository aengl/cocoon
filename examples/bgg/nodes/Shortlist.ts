import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * The action tier — the demo's "do something with the analysis" payoff.
 * Lists the N biggest positive deltas (overrated by the user) and the N
 * biggest negative deltas (underrated). Each row is a checkbox: clicking
 * toggles the game in `shortlist.json` (the node's own durable file),
 * `markStale()`'s the node, and the control re-derives — no node re-run.
 *
 * The shortlist file is ordinary node I/O (keystone 5 — durability is
 * not control state). A downstream node could read it via `ReadJSON` to
 * "publish the picks", or the agent can read it with `pnpm core peek`.
 *
 * Process is a pure pass-through that ALSO folds the live shortlist
 * `picked` flags into the rows on its frozen output — so the committed
 * dataset carries the picks, while the unsynced flips ride in the
 * control's `data()` payload (the keystone-5 "ephemeral overlay /
 * durable I/O" split, identical to AnnotateBoardgames).
 */

interface Row {
  id: string;
  name: string;
  delta: number;
  own_rating: number;
  community_avg: number;
  baseline?: number;
  weight?: number;
  year?: number | null;
  thumbnail?: string;
  [k: string]: unknown;
}

interface Shortlist {
  [id: string]: { reason: string; picked_at: string };
}

interface PickEntry {
  id: string;
  name: string;
  delta: number;
  own_rating: number;
  community_avg: number;
  weight?: number;
  year?: number | null;
  thumbnail?: string;
  picked: boolean;
  picked_at?: string;
  reason?: string;
}

interface ShortlistView {
  ready: boolean;
  overrated: PickEntry[];
  underrated: PickEntry[];
  total_picked: number;
  unsynced: number;
  topN: number;
}

const SHORTLIST_PATH = 'shortlist.json';

export const Shortlist: CocoonProcessNode = {
  category: 'BGG',
  description:
    'Pick rating outliers into a shortlist (durable side-file, action tier).',

  controls: {
    topN: {
      kind: 'number',
      label: 'top N per side',
      default: 10,
      min: 1,
      max: 50,
      step: 1,
    },
  },

  async *process(ctx) {
    const { games } = ctx.ports.read() as { games?: Row[] };
    const { topN } = ctx.controls.read() as { topN: number };
    const rows = Array.isArray(games) ? games : [];
    const shortlist = await readShortlist(ctx);

    const folded = rows.map(r => ({
      ...r,
      shortlisted: !!shortlist[r.id],
      shortlist_reason: shortlist[r.id]?.reason,
    }));

    ctx.ports.write({ games: folded, shortlist, topN });
    const picks = Object.keys(shortlist).length;
    return `${rows.length} games · ${picks} shortlisted · top ${topN}/side`;
  },

  control: {
    window: { width: 580, height: 700 },

    async data(ctx): Promise<ShortlistView> {
      const games = (ctx.output.games as Row[] | undefined) ?? [];
      const n = clampN(ctx.output.topN, 1, 50, 10);
      if (games.length === 0)
        return {
          ready: false,
          overrated: [],
          underrated: [],
          total_picked: 0,
          unsynced: 0,
          topN: n,
        };

      const shortlist = await readShortlist(ctx);
      const total_picked = Object.keys(shortlist).length;

      // Sort by raw delta — biggest positive first / biggest negative last.
      const sorted = [...games].sort((a, b) => b.delta - a.delta);
      const overrated = sorted.slice(0, n).map(r => toEntry(r, shortlist));
      const underrated = sorted
        .slice(-n)
        .reverse()
        .map(r => toEntry(r, shortlist));

      // Unsynced: rows whose `shortlisted` differs from the live file (the
      // "committed via last pull" view vs the "live durable truth" view).
      const committed = new Set(
        games.filter(r => (r as Row).shortlisted).map(r => r.id)
      );
      const live = new Set(Object.keys(shortlist));
      let unsynced = 0;
      for (const id of committed) if (!live.has(id)) unsynced++;
      for (const id of live) if (!committed.has(id)) unsynced++;

      return {
        ready: true,
        overrated,
        underrated,
        total_picked,
        unsynced,
        topN: n,
      };
    },

    render(ctx) {
      const d = (ctx.data as ShortlistView) ?? null;
      const compact = ctx.surface === 'node';

      if (!d?.ready) {
        return compact
          ? `${STYLE}<div class="shortlist-compact"><strong>Shortlist</strong><p>pull upstream to load picks</p>
  <button data-cocoon-event="$open">Open shortlist ▸</button></div>`
          : `${STYLE}<div class="shortlist"><p class="empty">No games yet — pull ComputeDeltas upstream.</p></div>`;
      }

      if (compact) {
        return `${STYLE}<div class="shortlist-compact">
  <strong>Shortlist</strong>
  <p>${d.total_picked} picked · top ${d.topN} per side${d.unsynced > 0 ? ` · ✎${d.unsynced}` : ''}</p>
  <button data-cocoon-event="$open">Open shortlist ▸</button>
</div>`;
      }

      return `${STYLE}<div class="shortlist">
  <header class="head">
    <h1>Shortlist outliers</h1>
    <p class="sub">${d.total_picked} game${d.total_picked === 1 ? '' : 's'} in <code>${SHORTLIST_PATH}</code>${
      d.unsynced > 0 ? ` · <em>✎ ${d.unsynced} unsynced — pull to fold downstream</em>` : ''
    }</p>
  </header>

  <section class="card pos">
    <h2>Top ${d.topN} overrated (rated above community)</h2>
    ${list(d.overrated, 'overrated')}
  </section>

  <section class="card neg">
    <h2>Top ${d.topN} underrated (rated below community)</h2>
    ${list(d.underrated, 'underrated')}
  </section>
</div>`;
    },

    async event(ctx, ev) {
      if (ev.event !== 'toggle') return;
      const p = (ev.payload ?? {}) as { id?: string; name?: string; reason?: string };
      const id = String(p.id ?? '').trim();
      if (!id) return;

      const shortlist = await readShortlist(ctx);
      if (shortlist[id]) delete shortlist[id];
      else
        shortlist[id] = {
          reason: String(p.reason ?? ''),
          picked_at: new Date().toISOString(),
        };
      await writeShortlist(ctx, shortlist);
      ctx.markStale();
    },
  },
};

// ---------------------------------------------------------------------------

function toEntry(r: Row, shortlist: Shortlist): PickEntry {
  const sl = shortlist[r.id];
  return {
    id: r.id,
    name: r.name,
    delta: r.delta,
    own_rating: r.own_rating,
    community_avg: r.community_avg,
    weight: r.weight,
    year: r.year,
    thumbnail: r.thumbnail,
    picked: !!sl,
    picked_at: sl?.picked_at,
    reason: sl?.reason,
  };
}

function list(entries: PickEntry[], side: string): string {
  if (entries.length === 0)
    return `<p class="empty">No entries for this side.</p>`;
  return `<ul class="entries">${entries
    .map(e => row(e, side))
    .join('')}</ul>`;
}

function row(e: PickEntry, side: string): string {
  const sign = e.delta >= 0 ? '+' : '';
  return `<li class="entry${e.picked ? ' picked' : ''}">
  <form data-cocoon-event="toggle">
    <input type="hidden" name="id" value="${esc(e.id)}" />
    <input type="hidden" name="name" value="${esc(e.name)}" />
    <input type="hidden" name="reason" value="${esc(side)}" />
    ${e.thumbnail ? `<img class="thumb" src="${esc(e.thumbnail)}" alt="" loading="lazy" />` : `<div class="thumb"></div>`}
    <div class="meta">
      <a class="name" href="https://boardgamegeek.com/boardgame/${esc(e.id)}" target="_blank" rel="noopener">${esc(e.name)}</a>
      <p class="kv">★ <b>${fmt(e.own_rating, 1)}</b> own · ${fmt(e.community_avg, 2)} community · Δ <em class="${e.delta >= 0 ? 'pos' : 'neg'}">${sign}${fmt(e.delta, 2)}</em>${
        e.year ? ` · ${e.year}` : ''
      }${e.weight ? ` · w ${fmt(e.weight, 1)}` : ''}</p>
    </div>
    <button type="submit" class="pick ${e.picked ? 'on' : ''}">${e.picked ? '✓ picked' : '+ pick'}</button>
  </form>
</li>`;
}

// ---------------------------------------------------------------------------
// File I/O (symmetric-import rule — dynamic node:* via opaque specifier; this
// node has no hook export, but the rule scales).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeImport = (spec: string): Promise<any> => import(spec);

interface IoCtx {
  resolvePath(...segments: string[]): string;
  debug(...args: unknown[]): void;
}

async function readShortlist(ctx: IoCtx): Promise<Shortlist> {
  const { promises: fs } = await nodeImport('node:fs');
  try {
    const text = await fs.readFile(ctx.resolvePath(SHORTLIST_PATH), 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Shortlist;
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT')
      ctx.debug('shortlist read error:', err);
    return {};
  }
}

async function writeShortlist(ctx: IoCtx, s: Shortlist): Promise<void> {
  const { promises: fs } = await nodeImport('node:fs');
  await fs.writeFile(
    ctx.resolvePath(SHORTLIST_PATH),
    JSON.stringify(s, null, 2),
    'utf8'
  );
}

// ---------------------------------------------------------------------------

function clampN(raw: unknown, min: number, max: number, def: number): number {
  let n = Number(raw);
  if (!Number.isFinite(n)) n = def;
  return Math.min(Math.max(min, Math.trunc(n)), max);
}

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const esc = (v: unknown): string =>
  String(v == null ? '' : v).replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!
  );

// ---------------------------------------------------------------------------

const STYLE = `<style>
.control .shortlist-compact { display:flex; flex-direction:column; gap:6px; }
.control .shortlist-compact strong { font-size:12px; color:#fb923c; }
.control .shortlist-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .shortlist-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .shortlist-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .shortlist {
  --card:#212128; --line:#303039; --line2:#3c3c47; --muted:#9a9aa6;
  --pos:#22d3ee; --neg:#f97373; --pick:#8b5cf6;
  display:flex; flex-direction:column; gap:14px; color:#e7e7ea; font-size:11.5px;
}
.control .shortlist .head h1 { margin:0; font-size:15px; color:#fb923c; }
.control .shortlist .head .sub { margin:3px 0 0 0; color:var(--muted); font-size:11px; }
.control .shortlist .head .sub code { background:#0e0e11; padding:1px 5px; border-radius:4px; color:#c4b5fd; font-size:10.5px; }
.control .shortlist .head .sub em { color:#fbbf24; font-style:normal; }
.control .shortlist .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
.control .shortlist .card h2 { margin:0; font-size:9.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.control .shortlist .card.pos h2 { color:#22d3ee; }
.control .shortlist .card.neg h2 { color:#f97373; }
.control .shortlist .entries { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px; }
.control .shortlist .entry form { display:flex; align-items:center; gap:10px; padding:6px; border:1px solid var(--line); border-radius:8px; background:#17171b; }
.control .shortlist .entry.picked form { border-color:var(--pick); background:#1c1729; }
.control .shortlist .thumb { flex:none; width:42px; height:42px; border-radius:6px; background:#26262d; border:1px solid var(--line2); object-fit:cover; }
.control .shortlist .meta { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.control .shortlist .name { color:#e7e7ea; text-decoration:none; font-weight:600; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.control .shortlist .name:hover { color:#c4b5fd; text-decoration:underline; }
.control .shortlist .kv { margin:0; color:var(--muted); font-size:10.5px; font-variant-numeric:tabular-nums; }
.control .shortlist .kv b { color:#fbbf24; }
.control .shortlist .kv em.pos { color:var(--pos); font-style:normal; font-weight:600; }
.control .shortlist .kv em.neg { color:var(--neg); font-style:normal; font-weight:600; }
.control .shortlist button.pick {
  flex:none; background:transparent; border:1px solid var(--line2); color:var(--muted);
  border-radius:6px; padding:5px 10px; font:inherit; font-size:11px; cursor:pointer;
  transition:background .12s, border-color .12s, color .12s;
}
.control .shortlist button.pick:hover { background:#26262d; color:#fff; border-color:#52525b; }
.control .shortlist button.pick.on { background:var(--pick); border-color:var(--pick); color:#fff; font-weight:600; }
.control .shortlist button.pick.on:hover { background:#7c4ddb; border-color:#7c4ddb; }
.control .shortlist .empty { color:var(--muted); font-style:italic; padding:20px; text-align:center; margin:0; }
</style>`;
