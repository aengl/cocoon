import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Curation node — the artifact-producing endpoint of the flow.
 *
 * `conditions:` is a literal YAML array of named filter specs (no
 * upstream edge — the human/AI populates this list deliberately by
 * promoting candidates from SurfaceGroups). For each condition the node
 * filters the movie population, sorts by the chosen metric, and emits the
 * top N. The produced port `curated` IS the new data — a structured
 * top-list per named filter that didn't exist anywhere before this pull.
 *
 * Filter spec — all fields optional; multiple fields AND together:
 *   name:           required, free text
 *   year_from/year_to:  release-year window (inclusive)
 *   genres:         array of genre names; film must carry ALL listed
 *   min_budget/max_budget, min_revenue/max_revenue
 *   min_vote_count, min_rating
 *   languages:      array of ISO-639-1 codes; original_language ∈ list
 *   where:          string JS predicate — escape hatch; `x => …` form,
 *                   evaluated once per row. Use only for things the
 *                   structured fields can't express.
 *   sort_by:        'popularity' | 'vote_average' | 'revenue' | 'roi'
 *                   | 'vote_count' | 'budget'   (default: popularity)
 *   top_n:          number, default 10.
 *
 * Per-condition failures (bad `where:` JS, etc.) are caught and surfaced
 * on that list only — sibling lists keep working.
 *
 * No durable side-file yet (per design call): the artifact lives on the
 * output port for now. Easy to add later as an event-tier "Export" button.
 *
 * Symmetric-import: no hook, pure HTML render.
 */

interface MovieRow {
  id: number;
  title: string;
  release_year: number;
  release_date: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  budget: number;
  revenue: number;
  runtime: number | null;
  genres: string[];
  original_language: string;
  poster_path: string | null;
}

interface Condition {
  name: string;
  year_from?: number;
  year_to?: number;
  genres?: string[];
  min_budget?: number;
  max_budget?: number;
  min_revenue?: number;
  max_revenue?: number;
  min_vote_count?: number;
  max_vote_count?: number;
  min_rating?: number;
  max_rating?: number;
  min_runtime?: number;
  max_runtime?: number;
  min_popularity?: number;
  max_popularity?: number;
  languages?: string[];
  where?: string;
  sort_by?: SortKey;
  top_n?: number;
}

type SortKey =
  | 'popularity'
  | 'vote_average'
  | 'revenue'
  | 'roi'
  | 'vote_count'
  | 'budget';

interface CuratedItem {
  rank: number;
  title: string;
  year: number;
  popularity: number;
  vote_average: number;
  vote_count: number;
  budget: number;
  revenue: number;
  roi: number;
  poster_path: string | null;
  id: number;
}

interface CuratedList {
  name: string;
  condition: Condition;
  sort_by: SortKey;
  n_matching: number;
  top: CuratedItem[];
  error?: string;
}

export const GenerateTopLists: CocoonProcessNode = {
  category: 'TMDB',
  description: 'Produce a top-N list per named filter — the curated artifact.',

  async *process(ctx) {
    const { movies, conditions } = ctx.ports.read() as {
      movies?: MovieRow[];
      conditions?: Condition[];
    };
    const rows = Array.isArray(movies) ? movies : [];
    const conds = Array.isArray(conditions) ? conditions : [];

    if (conds.length === 0) {
      ctx.ports.write({ curated: [] });
      return 'no conditions — add entries under `conditions:` in the YAML';
    }

    const out: CuratedList[] = conds.map(cond => buildList(cond, rows));
    ctx.ports.write({ curated: out });
    const counts = out.map(l => l.top.length);
    const errors = out.filter(l => l.error).length;
    return (
      `${out.length} lists · ${counts.reduce((s, n) => s + n, 0)} items total` +
      (errors ? ` · ${errors} with errors` : '')
    );
  },

  control: {
    window: { width: 720, height: 640 },
    data(ctx) {
      return (ctx.output.curated as CuratedList[] | undefined) ?? [];
    },
    render(ctx) {
      const lists = (ctx.data as CuratedList[]) ?? [];
      const compact = ctx.surface === 'node';
      if (lists.length === 0) {
        return compact
          ? `${STYLE}<div class="gl-compact"><strong>Curated lists</strong><p>no conditions — pull upstream / edit YAML</p>
  <button data-cocoon-event="$open">Open lists ▸</button></div>`
          : `${STYLE}<div class="gl"><p class="empty">No curated lists — add entries under <code>conditions:</code> in cocoon.yml.</p></div>`;
      }
      const total = lists.reduce((s, l) => s + l.top.length, 0);
      if (compact) {
        return `${STYLE}<div class="gl-compact">
  <strong>${lists.length} curated lists</strong>
  <p>${total} films · ${lists.map(l => esc(l.name)).slice(0, 3).join(' · ')}${lists.length > 3 ? ' · …' : ''}</p>
  <button data-cocoon-event="$open">Open lists ▸</button>
</div>`;
      }
      return `${STYLE}<div class="gl">
  <header class="head">
    <h1>Curated top-${lists[0]?.top.length || 10} lists</h1>
    <p class="sub">${lists.length} lists · ${total} films total · the produced artifact of this flow</p>
  </header>
  <div class="lists">
    ${lists.map(renderList).join('\n')}
  </div>
</div>`;
    },
  },
};

// ---------------------------------------------------------------------------
// Filtering + sorting.
// ---------------------------------------------------------------------------

function buildList(cond: Condition, rows: MovieRow[]): CuratedList {
  const sort_by: SortKey = cond.sort_by ?? 'popularity';
  const top_n = cond.top_n ?? 10;
  let wherePred: ((x: MovieRow) => boolean) | undefined;
  let whereError: string | undefined;
  if (cond.where) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      wherePred = new Function('x', `return (${cond.where})(x)`) as (
        x: MovieRow
      ) => boolean;
    } catch (e) {
      whereError = `bad where JS: ${String(e)}`;
    }
  }
  let matching = rows.filter(r => passes(r, cond));
  if (wherePred) {
    try {
      matching = matching.filter(r => Boolean(wherePred!(r)));
    } catch (e) {
      whereError = `where threw: ${String(e)}`;
      matching = [];
    }
  }
  matching.sort((a, b) => metric(b, sort_by) - metric(a, sort_by));
  const top: CuratedItem[] = matching.slice(0, top_n).map((m, i) => ({
    rank: i + 1,
    title: m.title,
    year: m.release_year,
    popularity: m.popularity,
    vote_average: m.vote_average,
    vote_count: m.vote_count,
    budget: m.budget,
    revenue: m.revenue,
    roi: m.budget > 0 ? m.revenue / m.budget : 0,
    poster_path: m.poster_path,
    id: m.id,
  }));
  return {
    name: cond.name,
    condition: cond,
    sort_by,
    n_matching: matching.length,
    top,
    error: whereError,
  };
}

function passes(m: MovieRow, c: Condition): boolean {
  if (c.year_from != null && m.release_year < c.year_from) return false;
  if (c.year_to != null && m.release_year > c.year_to) return false;
  if (c.genres && c.genres.length > 0) {
    for (const g of c.genres) if (!m.genres.includes(g)) return false;
  }
  if (c.min_budget != null && m.budget < c.min_budget) return false;
  if (c.max_budget != null && m.budget > c.max_budget) return false;
  if (c.min_revenue != null && m.revenue < c.min_revenue) return false;
  if (c.max_revenue != null && m.revenue > c.max_revenue) return false;
  if (c.min_vote_count != null && m.vote_count < c.min_vote_count) return false;
  if (c.max_vote_count != null && m.vote_count > c.max_vote_count) return false;
  if (c.min_rating != null && m.vote_average < c.min_rating) return false;
  if (c.max_rating != null && m.vote_average > c.max_rating) return false;
  if (c.min_runtime != null && (m.runtime ?? 0) < c.min_runtime) return false;
  if (c.max_runtime != null && (m.runtime ?? Infinity) > c.max_runtime) return false;
  if (c.min_popularity != null && m.popularity < c.min_popularity) return false;
  if (c.max_popularity != null && m.popularity > c.max_popularity) return false;
  if (c.languages && c.languages.length > 0 && !c.languages.includes(m.original_language))
    return false;
  return true;
}

function metric(m: MovieRow, key: SortKey): number {
  switch (key) {
    case 'popularity': return m.popularity ?? 0;
    case 'vote_average': return m.vote_average ?? 0;
    case 'revenue': return m.revenue ?? 0;
    case 'vote_count': return m.vote_count ?? 0;
    case 'budget': return m.budget ?? 0;
    case 'roi':
      return m.budget > 0 ? m.revenue / m.budget : 0;
  }
}

// ---------------------------------------------------------------------------
// HTML rendering.
// ---------------------------------------------------------------------------

function renderList(l: CuratedList): string {
  const desc = describeCondition(l.condition, l.sort_by);
  if (l.error) {
    return `<section class="list err">
  <header>
    <h2>${esc(l.name)}</h2>
    <span class="meta">${esc(l.error)}</span>
  </header>
</section>`;
  }
  if (l.top.length === 0) {
    return `<section class="list">
  <header>
    <h2>${esc(l.name)}</h2>
    <span class="meta">${esc(desc)} · 0 matches</span>
  </header>
  <p class="empty">No films matched.</p>
</section>`;
  }
  const items = l.top
    .map(
      it => `<li>
  <span class="rk">${it.rank}.</span>
  <span class="tt">${esc(it.title)} <em>(${it.year})</em></span>
  <span class="mv">${metricLabel(l.sort_by, it)}</span>
</li>`
    )
    .join('');
  return `<section class="list">
  <header>
    <h2>${esc(l.name)}</h2>
    <span class="meta">${esc(desc)} · ${l.n_matching} match${l.n_matching === 1 ? '' : 'es'}</span>
  </header>
  <ol>${items}</ol>
</section>`;
}

function describeCondition(c: Condition, sort_by: SortKey): string {
  const parts: string[] = [];
  if (c.year_from != null || c.year_to != null) {
    parts.push(`${c.year_from ?? '–'}…${c.year_to ?? '–'}`);
  }
  if (c.genres && c.genres.length) parts.push(c.genres.join('+'));
  if (c.languages && c.languages.length) parts.push(`lang ${c.languages.join('/')}`);
  if (c.min_budget != null || c.max_budget != null) {
    const lo = c.min_budget != null ? fmtM(c.min_budget) : '–';
    const hi = c.max_budget != null ? fmtM(c.max_budget) : '–';
    parts.push(`budget ${lo}…${hi}`);
  }
  if (c.min_vote_count != null) parts.push(`votes ≥ ${c.min_vote_count}`);
  if (c.min_rating != null) parts.push(`★ ≥ ${c.min_rating}`);
  if (c.where) parts.push(`+where`);
  parts.push(`by ${sort_by}`);
  return parts.join(' · ');
}

function metricLabel(key: SortKey, it: CuratedItem): string {
  switch (key) {
    case 'popularity': return `${it.popularity.toFixed(1)}`;
    case 'vote_average': return `★ ${it.vote_average.toFixed(2)}`;
    case 'revenue': return `$${fmtM(it.revenue)}`;
    case 'budget': return `$${fmtM(it.budget)}`;
    case 'vote_count': return `${it.vote_count.toLocaleString()}`;
    case 'roi': return `${it.roi.toFixed(1)}×`;
  }
}

function fmtM(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

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

const STYLE = `<style>
.control .gl-compact { display:flex; flex-direction:column; gap:6px; }
.control .gl-compact strong { font-size:12px; color:#fb923c; }
.control .gl-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .gl-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }

.control .gl { display:flex; flex-direction:column; gap:10px; height:100%; color:#e7e7ea; font-size:11.5px; }
.control .gl .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .gl .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; }
.control .gl .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }
.control .gl .empty code { background:#1f1f27; padding:1px 4px; border-radius:3px; color:#c4b5fd; font-size:10.5px; }

.control .gl .lists { display:flex; flex-direction:column; gap:10px; overflow-y:auto; padding-right:6px; }
.control .gl .list { background:#15151b; border:1px solid #2a2a31; border-radius:6px; padding:8px 12px 10px; }
.control .gl .list.err { border-color:#7f1d1d; }
.control .gl .list header { display:flex; justify-content:space-between; align-items:baseline; gap:8px; padding-bottom:6px; border-bottom:1px solid #232329; margin-bottom:6px; }
.control .gl .list header h2 { margin:0; font-size:12.5px; color:#c4b5fd; font-weight:600; }
.control .gl .list header .meta { color:#71717a; font-size:10px; font-variant-numeric:tabular-nums; }
.control .gl .list ol { margin:0; padding:0; list-style:none; counter-reset:none; }
.control .gl .list li { display:grid; grid-template-columns:24px 1fr auto; align-items:baseline; gap:8px; padding:2px 0; font-size:11px; }
.control .gl .list li .rk { color:#71717a; text-align:right; font-variant-numeric:tabular-nums; }
.control .gl .list li .tt { color:#e7e7ea; }
.control .gl .list li .tt em { color:#71717a; font-style:normal; font-size:10px; }
.control .gl .list li .mv { color:#fbbf24; font-variant-numeric:tabular-nums; font-size:10.5px; }
.control .gl .list .empty { color:#71717a; font-style:italic; font-size:10.5px; padding:4px 0 0; }
</style>`;
