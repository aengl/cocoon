import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Bespoke batch-rater (keystone 6 — a meaning-node carries its own code;
 * generic `Annotate` is untouched). The control = CocoonView split applied
 * to a control:
 *
 *  - `process()` is a **pure data transform**: merge the ratings file into
 *    the rows. No control state, no rerun.
 *  - `control.data()` is the **core-side data half**: derive a *bounded*
 *    batch — the next ≤5 games not in the ratings file — straight from
 *    (inputs + file). Pure derivation, never cached, so the file is the
 *    single source of truth (rate advances it; wipe it ⇒ restart).
 *  - `control.render()` draws that batch (compact on the node, full list in
 *    the window).
 *  - `control.event()` writes the durable file and `ctx.markStale()`s — the
 *    node's output is now outdated, the operator pulls when they want it
 *    folded downstream. **No node re-run per rating**: the control stays
 *    live because the core re-derives `data()` (presentation, not a pull).
 *
 * Plus a **search** facet (the experiment): a "find a game to (re-)rate" box
 * inside the same dialog. Its query is the *one* legitimate use of the
 * opaque control blob — an unsaved input *draft* (exactly Annotate's
 * textarea-before-Save), NOT derived state. The results are still pure
 * derivation from (inputs + live file + query), never cached, each match
 * carrying its current rating so it doubles as "look up a previously rated
 * game". Re-annotation reuses the existing `rate` event verbatim (it already
 * overwrites + `markStale`s); `search` only sets the draft (no stale, no
 * durable write) — the draft/durable split the contract insists on, shown.
 */
const BATCH = 5;
/** Cap search results — the payload stays bounded (it streams as the agent's
 *  `controlData` slice too, so this is a real bound, not just UI tidiness). */
const SEARCH_MAX = 8;

/**
 * The node ships its **own** styling, streamed inside its rendered HTML — the
 * exact dual of it rendering its own markup (keystone 6: the node's source is
 * the contract; keystone 5: HTML is data). `CocoonNode` provides only generic
 * dark-theme defaults (form/input/button) so an unstyled control still looks
 * right; anything node-specific lives here, scoped under the node's own root
 * class so co-resident control windows don't collide. Injected via the shim's
 * `innerHTML`, so a plain `<style>` applies (idempotent across re-renders).
 */
const STYLE = `<style>
.control .rater,
.control .rater-compact { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
.control .rater-compact { align-items:flex-start; }
.control .rate-row { display:flex; flex-direction:row; align-items:center; gap:8px; padding:4px 0; border-top:1px solid #27272a; }
.control .rate-row .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e4e4e7; }
.control .rate-row .row { flex:none; display:flex; gap:3px; }
.control .rate-row .row button { flex:none; padding:2px 5px; font-size:12px; letter-spacing:-2px; }
.control .commit-hint { color:#fbbf24; margin-top:6px; font-size:10px; border-top:1px dashed #3f3f46; padding-top:6px; }
.control .rater-search-wrap { display:flex; gap:6px; align-items:center; }
.control .rater-search { display:flex; gap:6px; flex:1; min-width:0; }
.control .rater-search input { flex:1; min-width:0; }
.control .rater-search button,
.control .rater-search-wrap .clear { flex:none; }
.control .search-label,
.control .queue-label { margin:4px 0 0; color:#c4b5fd; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; }
.control .search-empty { color:#a1a1aa; font-style:italic; }
.control .rate-row .badge { flex:none; font-size:9.5px; color:#71717a; white-space:nowrap; }
.control .rate-row .badge.rated { color:#fbbf24; }
.control .rater hr.sep { border:none; border-top:1px solid #27272a; margin:8px 0 2px; }
</style>`;

type Row = Record<string, unknown>;
type Ratings = Record<string, { rating: number; $rated: string }>;
interface Batch {
  /** The next ≤BATCH unrated games — a *sliding* window over the live file
   *  (rate one ⇒ it drops, the next slides in). Pure derivation, no cache. */
  items: { id: string; title: string }[];
  rated: number; // overall, live from the file
  total: number;
  /** Rated since the last pull, not yet folded downstream (the commit
   *  hint): live file rated − rated baked into the frozen output. */
  unsynced: number;
  /** The current search *draft* — held in the opaque control blob, NOT the
   *  durable file. `''` ⇒ the search box is shown but idle. */
  query: string;
  /** Bounded matches for `query` across the whole library, each annotated
   *  with its live rating (re-rating reuses the `rate` event). Pure
   *  derivation from (inputs + file + query) — never cached. */
  results: {
    id: string;
    title: string;
    rating: number | null;
    rated: string | null;
  }[];
}

export const RateGames: CocoonProcessNode = {
  category: 'Annotation',
  description: 'Rate items continuously; ratings merge back into the data.',

  // Pure data transform — merge the ratings file into the rows. No control
  // state, no batch port, no rerun. A pull folds whatever's rated so far
  // into the output (the commit); the control keeps flowing between pulls.
  async *process(ctx) {
    const { data, key } = ctx.ports.read() as { data: Row[]; key: string };
    const games = Array.isArray(data) ? data : [];
    const ratings = await readRatings(ctx);
    const merged = games.map(g =>
      ratings[String(g[key])] ? { ...g, ...ratings[String(g[key])] } : g
    );
    ctx.ports.write({ data: merged, ratings });
    const rated = games.filter(g => ratings[String(g[key])]).length;
    return `${rated}/${games.length} rated`;
  },

  control: {
    // Sliding window: the next ≤BATCH unrated games, a pure function of
    // (inputs, live file) — nothing cached, so the file is the only truth.
    // `unsynced` compares it to the *frozen output* (what a pull last
    // committed downstream) purely to surface drift, never to gate flow.
    async data(ctx): Promise<Batch> {
      const { data, key } = ctx.ports.read() as { data?: Row[]; key: string };
      const games = Array.isArray(data) ? data : [];
      const ratings = await readRatings(ctx);
      const unrated = games.filter(g => !ratings[String(g[key])]);
      const liveRated = games.length - unrated.length;
      const out = ctx.output.data as Row[] | undefined;
      const committed = Array.isArray(out)
        ? out.filter(r => r.rating != null).length
        : 0;

      // The search query is a *draft* (opaque control blob — the lone legit
      // use). The results below are still pure derivation from (games + live
      // ratings + query): nothing about search is cached, the file stays the
      // single truth, exactly like the conveyor.
      const query = String(
        (ctx.control.read() as { q?: unknown }).q ?? ''
      ).trim();
      const ql = query.toLowerCase();
      const results = !ql
        ? []
        : games
            .filter(g => {
              const id = String(g[key]).toLowerCase();
              const title = String(g.title ?? '').toLowerCase();
              return id.includes(ql) || title.includes(ql);
            })
            .slice(0, SEARCH_MAX)
            .map(g => {
              const r = ratings[String(g[key])];
              return {
                id: String(g[key]),
                title: String(g.title ?? g[key]),
                rating: r ? r.rating : null,
                rated: r ? String(r.$rated).slice(0, 10) : null,
              };
            });

      return {
        items: unrated.slice(0, BATCH).map(g => ({
          id: String(g[key]),
          title: String(g.title ?? g[key]),
        })),
        rated: liveRated,
        total: games.length,
        unsynced: Math.max(0, liveRated - committed),
        query,
        results,
      };
    },

    render(ctx) {
      const b = (ctx.data as Batch) ?? {
        items: [],
        rated: 0,
        total: 0,
        unsynced: 0,
        query: '',
        results: [],
      };

      if (ctx.surface === 'node') {
        const line =
          b.total === 0
            ? 'run the node'
            : `${b.rated}/${b.total} rated${b.unsynced > 0 ? ` · ✎${b.unsynced}` : ''}`;
        return `${STYLE}<div class="rater-compact">
  <strong>Rater</strong>
  <p>${line}</p>
  <button data-cocoon-event="$open">Open rater ▸</button>
</div>`;
      }

      // window surface — search box + the sliding conveyor.
      if (b.total === 0)
        return `${STYLE}<div class="rater"><p>run the node to load games</p></div>`;

      // One star-form builder, reused by conveyor rows and search hits — the
      // `rate` event is identical (re-rating just overwrites the file).
      const stars = [1, 2, 3, 4, 5]
        .map(
          n =>
            `<button type="submit" name="rating" value="${n}" title="${n}">${'★'.repeat(n)}</button>`
        )
        .join('');
      // `extra` is a non-clipped cell between the (ellipsised) title and the
      // stars — the search hits use it for the current-rating badge.
      const rateRow = (title: string, id: string, extra = '') =>
        `<form class="rate-row" data-cocoon-event="rate">
  <input type="hidden" name="id" value="${esc(id)}" />
  <span class="t">${esc(title)}</span>
  ${extra}
  <span class="row">${stars}</span>
</form>`;

      // The search box is `data-cocoon-event="search"` → sets the draft. The
      // "clear" button sits *outside* the form on purpose: the shim sends the
      // enclosing form's fields, so a no-form button posts `{}` ⇒ empty query.
      const search = `<div class="rater-search-wrap">
  <form class="rater-search" data-cocoon-event="search">
    <input type="text" name="q" value="${esc(b.query)}" placeholder="Find a game to (re-)rate…" autocomplete="off" />
    <button type="submit">Search</button>
  </form>
  ${b.query ? `<button type="button" class="clear" data-cocoon-event="search">clear</button>` : ''}
</div>`;

      let found = '';
      if (b.query) {
        if (b.results.length === 0) {
          found = `<p class="search-empty">no games match “${esc(b.query)}”</p>`;
        } else {
          const hits = b.results
            .map(r => {
              const badge =
                r.rating != null
                  ? `<span class="badge rated">${'★'.repeat(r.rating)} · ${esc(r.rated ?? '')}</span>`
                  : `<span class="badge">unrated</span>`;
              return rateRow(r.title, r.id, badge);
            })
            .join('');
          found = `<p class="search-label">${b.results.length} match${
            b.results.length === 1 ? '' : 'es'
          } — click stars to (re-)rate</p>${hits}`;
        }
      }

      // A terse drift count only — NOT an explanation of the pull model.
      // The graph already shows this node + downstream amber/`stale`; the
      // control needn't restate it (and "commit" would read as "save to
      // JSON", which the rating already did — the file is the durable
      // truth; the pull just folds it *downstream*).
      const commitHint =
        b.unsynced > 0
          ? `<p class="commit-hint">✎ ${b.unsynced} rated since the last pull</p>`
          : '';
      const queue =
        b.items.length === 0
          ? `<h3>🎉 all ${b.total} rated</h3>${commitHint}`
          : `<p class="queue-label">next up — ${b.rated} / ${b.total} rated</p>${b.items
              .map(it => rateRow(it.title, it.id))
              .join('')}${commitHint}`;

      return `${STYLE}<div class="rater">
  ${search}
  ${found}
  <hr class="sep" />
  ${queue}
</div>`;
    },

    async event(ctx, ev) {
      // Search only updates the *draft* — no durable write, no markStale.
      // The core re-derives data() after every event, so the result list
      // refreshes from the live file purely as presentation.
      if (ev.event === 'search') {
        const q = String(
          (ev.payload as { q?: unknown } | undefined)?.q ?? ''
        ).trim();
        ctx.control.set({ q });
        return;
      }
      if (ev.event !== 'rate') return;
      const p = (ev.payload ?? {}) as { id?: unknown; rating?: unknown };
      const id = String(p.id ?? '').trim();
      const rating = Number(p.rating ?? NaN);
      if (!id || !Number.isFinite(rating)) return;
      const ratings = await readRatings(ctx);
      ratings[id] = { rating, $rated: new Date().toISOString() };
      await writeRatings(ctx, ratings); // the durable truth
      // Output is now outdated — honest pull signal, NOT a rerun. The core
      // re-derives data() so the queue slides; the node stays `stale` until
      // the user pulls to commit downstream (surfaced as `unsynced`).
      ctx.markStale();
    },
  },
};

const esc = (v: unknown): string =>
  String(v).replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!
  );

/** Minimal ctx shape shared by `process` and the control halves. */
type IoCtx = {
  ports: { read(): Record<string, unknown> };
  cocoonFilePath: string;
  debug(...a: unknown[]): void;
};

function ratingsPath(ctx: IoCtx): string {
  const { path: p } = ctx.ports.read() as { path: string };
  return path.isAbsolute(p)
    ? p
    : path.resolve(path.dirname(ctx.cocoonFilePath), p);
}

async function readRatings(ctx: IoCtx): Promise<Ratings> {
  try {
    return JSON.parse(await fs.readFile(ratingsPath(ctx), 'utf8')) as Ratings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT')
      ctx.debug('error reading ratings file:', err);
    return {};
  }
}

async function writeRatings(ctx: IoCtx, data: Ratings): Promise<void> {
  const p = ratingsPath(ctx);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}
