import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Bespoke single-item annotator (keystone 6) — the *one-at-a-time + textarea*
 * sibling of `RateGames`. Same control = CocoonView split, same pull-only
 * contract; only the affordance differs (a free-text description per game
 * instead of a 1–5 conveyor):
 *
 *  - `process()` is a **pure transform**: merge the descriptions file into the
 *    rows (a `description` field). No control state, no rerun.
 *  - `control.data()` derives the **single game now in focus** straight from
 *    (inputs + file). A cursor `idx` selects it — and that cursor is the *one*
 *    legitimate use of the opaque control blob: navigation *intent*, an
 *    unsaved input draft (exactly `RateGames`' search query), NOT derived
 *    state. Unset ⇒ slide to the first not-yet-described game (the conveyor
 *    feel, batch of one). The description shown is always re-read from the
 *    durable file, never cached.
 *  - `control.render()` draws that one game with a `<textarea>` prefilled from
 *    the file (compact summary on the node, full editor in the window).
 *  - `control.event()` — `prev`/`next`/`skip` only move the cursor (draft, no
 *    durable write, no `markStale`, exactly like `search`); `save` writes the
 *    durable file and `markStale()`s. **No node re-run per save**: the core
 *    re-derives `data()` so the editor stays live; the operator pulls when
 *    they want it folded downstream (surfaced as `unsynced`).
 *
 * Why this node exists in *this* flow: it branches off `Games` in parallel to
 * `RateGames`, and a downstream `Join` merges ratings + descriptions back into
 * one collection — a second annotation surface whose free-text payload is the
 * natural target for the next step (an agent meaningfully editing a complex
 * control: "translate / draft this game's description").
 */
const FIELD = 'description';

type Row = Record<string, unknown>;
type Descriptions = Record<string, { description: string; $described: string }>;

interface View {
  /** The single game in focus (id, title, its live description), or null. */
  game: { id: string; title: string; description: string } | null;
  idx: number; // 0-based cursor into the input game list (the draft cursor)
  total: number;
  described: number; // overall, live from the file
  /** Described since the last pull, not yet folded downstream (drift hint):
   *  live file described − described baked into the frozen output. */
  unsynced: number;
}

/**
 * The node's own styling, streamed inside its rendered HTML (keystone 5/6 —
 * HTML is data, the node's source is the contract). `CocoonNode` ships only
 * generic dark-theme defaults (form/input/button); everything node-specific
 * is here, scoped under a self-contained `.describe*` root (it deliberately
 * does *not* lean on RateGames' `.rater`, so the two never collide when both
 * control windows are open). Injected via the shim's `innerHTML`.
 */
const STYLE = `<style>
.control .describe,
.control .describe-compact { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
.control .describe-compact { align-items:flex-start; }
.control .describe .nav { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
.control .describe .nav .pos { color:#a1a1aa; font-size:10px; font-variant-numeric:tabular-nums; }
.control .describe .nav .clear { margin-left:auto; }
.control .describe .nav button[disabled] { opacity:0.4; cursor:default; }
.control .describe .row { display:flex; gap:6px; }
.control .describe h3 small { color:#71717a; font-weight:400; font-size:11px; }
.control .describe .commit-hint { color:#fbbf24; margin-top:6px; font-size:10px; border-top:1px dashed #3f3f46; padding-top:6px; }
</style>`;

export const DescribeGames: CocoonProcessNode = {
  category: 'Annotation',
  description:
    'Describe one game at a time; descriptions merge back into the data.',

  // Pure data transform — merge the descriptions file into the rows. A pull
  // folds whatever's described so far into the output (the commit); the
  // control keeps flowing between pulls.
  async *process(ctx) {
    const { data, key } = ctx.ports.read() as { data: Row[]; key: string };
    const games = Array.isArray(data) ? data : [];
    const descriptions = await readDescriptions(ctx);
    const merged = games.map(g => {
      const d = descriptions[String(g[key])];
      return d ? { ...g, [FIELD]: d.description } : g;
    });
    ctx.ports.write({ data: merged, descriptions });
    const n = games.filter(g => descriptions[String(g[key])]).length;
    return `${n}/${games.length} described`;
  },

  control: {
    // One game in focus, a pure function of (inputs, live file, cursor).
    // Nothing cached: the description is always re-read from the file, the
    // cursor is a draft. `unsynced` compares to the *frozen output* (what a
    // pull last committed downstream) purely to surface drift.
    async data(ctx): Promise<View> {
      const { games, key, descriptions } = await loadState(ctx);
      const describedCount = games.filter(
        g => descriptions[String(g[key])]
      ).length;
      const idx = deriveIdx(
        (ctx.control.read() as { idx?: unknown }).idx,
        games,
        key,
        descriptions
      );

      const g = games[idx];
      const game = g
        ? {
            id: String(g[key]),
            title: String(g.title ?? g[key]),
            description: descriptions[String(g[key])]?.description ?? '',
          }
        : null;

      const out = ctx.output.data as Row[] | undefined;
      const committed = Array.isArray(out)
        ? out.filter(r => typeof r[FIELD] === 'string' && r[FIELD]).length
        : 0;

      return {
        game,
        idx,
        total: games.length,
        described: describedCount,
        unsynced: Math.max(0, describedCount - committed),
      };
    },

    render(ctx) {
      const v = (ctx.data as View) ?? {
        game: null,
        idx: 0,
        total: 0,
        described: 0,
        unsynced: 0,
      };

      if (ctx.surface === 'node') {
        const line =
          v.total === 0
            ? 'run the node'
            : `${v.described}/${v.total} described${
                v.unsynced > 0 ? ` · ✎${v.unsynced}` : ''
              }`;
        return `${STYLE}<div class="describe-compact">
  <strong>Describe</strong>
  <p>${line}</p>
  <button data-cocoon-event="$open">Open describer ▸</button>
</div>`;
      }

      // window surface — one game, navigation, a textarea.
      if (v.total === 0 || !v.game)
        return `${STYLE}<div class="describe"><p>run the node to load games</p></div>`;

      const g = v.game;
      const atStart = v.idx === 0;
      const atEnd = v.idx >= v.total - 1;
      const allDone = v.described >= v.total;

      // A terse drift count only — the graph already shows stale/done by
      // colour; "save" already happened (the file is the durable truth), the
      // pull only folds it downstream, so this is a count, not an explanation.
      const commitHint =
        v.unsynced > 0
          ? `<p class="commit-hint">✎ ${v.unsynced} described since the last pull</p>`
          : '';

      return `${STYLE}<div class="describe">
  <div class="nav">
    <button type="button" data-cocoon-event="prev"${atStart ? ' disabled' : ''}>‹ prev</button>
    <span class="pos">${v.idx + 1} / ${v.total}</span>
    <button type="button" data-cocoon-event="next"${atEnd ? ' disabled' : ''}>next ›</button>
    <button type="button" class="clear" data-cocoon-event="skip"${
      allDone ? ' disabled' : ''
    }>next undescribed »</button>
  </div>
  <form data-cocoon-event="save">
    <input type="hidden" name="id" value="${esc(g.id)}" />
    <h3>${esc(g.title)} <small>#${esc(g.id)}</small></h3>
    <label>description
      <textarea name="description" rows="8" placeholder="Describe ${esc(
        g.title
      )}…">${esc(g.description)}</textarea>
    </label>
    <div class="row">
      <button type="submit">Save</button>
    </div>
  </form>
  ${commitHint}
</div>`;
    },

    async event(ctx, ev) {
      // prev/next/skip are pure navigation — set the *draft* cursor only, no
      // durable write, no markStale (exactly RateGames' `search`).
      if (
        ev.event === 'prev' ||
        ev.event === 'next' ||
        ev.event === 'skip'
      ) {
        const { games, key, descriptions } = await loadState(ctx);
        if (games.length === 0) return;
        if (ev.event === 'skip') {
          // Jump to the next undescribed game after the current one (wrap).
          const cur = deriveIdx(
            (ctx.control.read() as { idx?: unknown }).idx,
            games,
            key,
            descriptions
          );
          const order = [
            ...games.slice(cur + 1),
            ...games.slice(0, cur + 1),
          ];
          const hit = order.find(g => !descriptions[String(g[key])]);
          if (hit) ctx.control.set({ idx: games.indexOf(hit) });
          return;
        }
        const cur = deriveIdx(
          (ctx.control.read() as { idx?: unknown }).idx,
          games,
          key,
          descriptions
        );
        const next = ev.event === 'prev' ? cur - 1 : cur + 1;
        ctx.control.set({
          idx: Math.min(Math.max(0, next), games.length - 1),
        });
        return;
      }

      if (ev.event !== 'save') return;
      const p = (ev.payload ?? {}) as { id?: unknown; description?: unknown };
      const id = String(p.id ?? '').trim();
      if (!id) return void ctx.debug('save ignored: empty id');
      const text = String(p.description ?? '').trim();
      const descriptions = await readDescriptions(ctx);
      if (text) {
        descriptions[id] = { description: text, $described: new Date().toISOString() };
      } else {
        // Empty ⇒ un-describe (symmetric; the row loses it on next pull).
        delete descriptions[id];
      }
      await writeDescriptions(ctx, descriptions); // the durable truth
      // Output is now outdated — honest pull signal, NOT a rerun. The core
      // re-derives data() so the editor stays live; the node stays `stale`
      // until the user pulls to fold descriptions downstream.
      ctx.markStale();
    },
  },
};

/**
 * Cursor resolution shared by `data()` and `event()` so navigation moves from
 * exactly the index on screen. Unset ⇒ the first not-yet-described game (the
 * sliding "conveyor of one"); otherwise the pinned, clamped draft index.
 */
function deriveIdx(
  blobIdx: unknown,
  games: Row[],
  key: string,
  descriptions: Descriptions
): number {
  if (games.length === 0) return 0;
  let idx: number;
  if (blobIdx == null) {
    const first = games.findIndex(g => !descriptions[String(g[key])]);
    idx = first === -1 ? 0 : first;
  } else {
    idx = Number(blobIdx);
  }
  if (!Number.isFinite(idx)) idx = 0;
  return Math.min(Math.max(0, Math.trunc(idx)), games.length - 1);
}

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

async function loadState(
  ctx: IoCtx
): Promise<{ games: Row[]; key: string; descriptions: Descriptions }> {
  const { data, key } = ctx.ports.read() as { data?: Row[]; key: string };
  return {
    games: Array.isArray(data) ? data : [],
    key,
    descriptions: await readDescriptions(ctx),
  };
}

function descriptionsPath(ctx: IoCtx): string {
  const { path: p } = ctx.ports.read() as { path: string };
  return path.isAbsolute(p)
    ? p
    : path.resolve(path.dirname(ctx.cocoonFilePath), p);
}

async function readDescriptions(ctx: IoCtx): Promise<Descriptions> {
  try {
    return JSON.parse(
      await fs.readFile(descriptionsPath(ctx), 'utf8')
    ) as Descriptions;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT')
      ctx.debug('error reading descriptions file:', err);
    return {};
  }
}

async function writeDescriptions(
  ctx: IoCtx,
  data: Descriptions
): Promise<void> {
  const p = descriptionsPath(ctx);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}
