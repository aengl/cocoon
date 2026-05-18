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
 * No cursor, no opaque blob, no `$mount` handler — every cached-state bug in
 * this model came from caching what should be derived; this caches nothing.
 */
const BATCH = 5;

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
      return {
        items: unrated.slice(0, BATCH).map(g => ({
          id: String(g[key]),
          title: String(g.title ?? g[key]),
        })),
        rated: liveRated,
        total: games.length,
        unsynced: Math.max(0, liveRated - committed),
      };
    },

    render(ctx) {
      const b = (ctx.data as Batch) ?? {
        items: [],
        rated: 0,
        total: 0,
        unsynced: 0,
      };
      const sync =
        b.unsynced > 0
          ? ` · <span class="commit">✎ ${b.unsynced} to commit</span>`
          : '';

      if (ctx.surface === 'node') {
        const line =
          b.total === 0
            ? 'run the node'
            : `${b.rated}/${b.total} rated${b.unsynced > 0 ? ` · ✎${b.unsynced}` : ''}`;
        return `<div class="rater-compact">
  <strong>Rater</strong>
  <p>${line}</p>
  <button data-cocoon-event="$open">Open rater ▸</button>
</div>`;
      }

      // window surface — the sliding queue
      if (b.total === 0)
        return `<div class="rater"><p>run the node to load games</p></div>`;
      const commitHint =
        b.unsynced > 0
          ? `<p class="commit-hint">✎ ${b.unsynced} rated since the last pull · pull the node to commit them downstream</p>`
          : '';
      if (b.items.length === 0)
        return `<div class="rater"><h3>🎉 all ${b.total} rated</h3>
  ${commitHint || `<p>node is stale — pull to fold the ratings downstream</p>`}</div>`;
      const rows = b.items
        .map(it => {
          const stars = [1, 2, 3, 4, 5]
            .map(
              n =>
                `<button type="submit" name="rating" value="${n}" title="${n}">${'★'.repeat(
                  n
                )}</button>`
            )
            .join('');
          return `<form class="rate-row" data-cocoon-event="rate">
  <input type="hidden" name="id" value="${esc(it.id)}" />
  <span class="t">${esc(it.title)}</span>
  <span class="row">${stars}</span>
</form>`;
        })
        .join('');
      return `<div class="rater">
  <p>${b.rated} / ${b.total} rated${sync}</p>
  ${rows}
  ${commitHint}
</div>`;
    },

    async event(ctx, ev) {
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
