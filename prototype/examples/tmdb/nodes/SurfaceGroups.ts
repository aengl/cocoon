import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Discovery node — surfaces *cross-dimensional* candidate groups whose
 * concentration is unusually high relative to a baseline expectation.
 * v1 scans the (genre × year-window) grid: for each genre G and each
 * sliding year-window W, count films tagged with G in W (observed) vs
 * the count you'd expect under the null that genre membership is uniform
 * over time (expected = total_in_W × P(G)). Rank cells by a Poisson-style
 * z-score `(obs − exp) / √exp`. Cells with `obs ≥ min_observed` are
 * eligible; the top `top_k` by score become candidate groups.
 *
 * The output is *suggestions*, not verdicts. Each candidate carries a
 * filter spec the human can paste into GenerateTopLists.conditions for
 * promotion — that's the bridge between Mining and Curation, kept
 * deliberately manual (the moment of judgement is the whole point).
 *
 * Why not k-means: k-means on the numeric feature vector won't find
 * "Westerns 2010–2015" — genre is categorical, the spike is local in
 * time, and the surprise is *vs baseline*, not vs other films. Density
 * mining is the right primitive for this question.
 *
 * Symmetric-import: pure HTML control, no `hook` needed → top-level
 * `import type` is fine; no external deps.
 */

interface MovieRow {
  id: number;
  title: string;
  release_year: number;
  popularity: number;
  vote_average: number;
  vote_count: number;
  genres: string[];
  poster_path: string | null;
}

interface Candidate {
  // Filter spec — directly copy-pasteable into GenerateTopLists.conditions.
  name: string;
  year_from: number;
  year_to: number;
  genres: string[];

  // Mining provenance.
  observed: number;
  expected: number;
  score: number;          // (obs - exp) / sqrt(exp), Poisson-style z.
  baseline_share: number; // genre frequency in the global population.
  window_share: number;   // genre frequency in this window.

  // For the card body — 5 most popular films matching this cell.
  exemplars: Array<{
    id: number;
    title: string;
    year: number;
    popularity: number;
    vote_average: number;
  }>;
}

export const SurfaceGroups: CocoonProcessNode = {
  category: 'TMDB',
  description: 'Density-spike mining across (genre × year-window).',

  controls: {
    window_size: {
      kind: 'number',
      label: 'window (years)',
      default: 5,
      min: 2,
      max: 15,
      step: 1,
    },
    top_k: {
      kind: 'number',
      label: 'top K candidates',
      default: 30,
      min: 5,
      max: 200,
      step: 5,
    },
    min_observed: {
      kind: 'number',
      label: 'min observed (noise floor)',
      default: 5,
      min: 2,
      max: 50,
      step: 1,
    },
  },

  async *process(ctx) {
    const { movies } = ctx.ports.read() as { movies?: MovieRow[] };
    const { window_size, top_k, min_observed } = ctx.controls.read() as {
      window_size: number;
      top_k: number;
      min_observed: number;
    };
    const rows = (Array.isArray(movies) ? movies : []).filter(
      m =>
        Number.isFinite(m.release_year) &&
        m.release_year > 1900 &&
        Array.isArray(m.genres) &&
        m.genres.length > 0
    );
    if (rows.length === 0) {
      ctx.ports.write({ candidates: [] });
      return 'no rows';
    }

    // -- baseline: per-genre frequency over the full population ----------
    const genreCount = new Map<string, number>();
    for (const m of rows)
      for (const g of m.genres)
        genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
    const total = rows.length;
    const genres = [...genreCount.keys()];

    // -- index by year for fast window slicing ---------------------------
    const byYear = new Map<number, MovieRow[]>();
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of rows) {
      const y = m.release_year;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      let bucket = byYear.get(y);
      if (!bucket) {
        bucket = [];
        byYear.set(y, bucket);
      }
      bucket.push(m);
    }

    yield `scanning ${genres.length} genres × ${maxY - minY + 1} years with window=${window_size}…`;

    // -- score every (genre, window) cell --------------------------------
    const candidates: Candidate[] = [];
    for (let y = minY; y + window_size - 1 <= maxY; y++) {
      // gather window films + total
      const winFilms: MovieRow[] = [];
      for (let dy = 0; dy < window_size; dy++) {
        const b = byYear.get(y + dy);
        if (b) winFilms.push(...b);
      }
      const N = winFilms.length;
      if (N < min_observed) continue;
      for (const g of genres) {
        let obs = 0;
        for (const m of winFilms) if (m.genres.includes(g)) obs++;
        if (obs < min_observed) continue;
        const pG = (genreCount.get(g) ?? 0) / total;
        const exp = N * pG;
        if (exp <= 0) continue;
        const score = (obs - exp) / Math.sqrt(exp);
        if (score <= 0) continue;
        const exemplars = winFilms
          .filter(m => m.genres.includes(g))
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, 5)
          .map(m => ({
            id: m.id,
            title: m.title,
            year: m.release_year,
            popularity: m.popularity,
            vote_average: m.vote_average,
          }));
        candidates.push({
          name: `${g} ${y}–${y + window_size - 1}`,
          year_from: y,
          year_to: y + window_size - 1,
          genres: [g],
          observed: obs,
          expected: +exp.toFixed(2),
          score: +score.toFixed(2),
          baseline_share: +pG.toFixed(3),
          window_share: +(obs / N).toFixed(3),
          exemplars,
        });
      }
    }

    // -- dedupe overlapping windows for the same genre -------------------
    // Adjacent year-windows of the same genre often score similarly. Keep
    // only the highest-score window in any group of overlaps so the UI
    // doesn't show "Western 2010–2014", "Western 2011–2015", "Western
    // 2012–2016" as three candidates. Greedy: sort by score desc, drop
    // any later candidate whose window overlaps an already-kept one of
    // the same genre.
    candidates.sort((a, b) => b.score - a.score);
    const kept: Candidate[] = [];
    const keptByGenre = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const g = c.genres[0];
      const prior = keptByGenre.get(g) ?? [];
      const overlaps = prior.some(
        p => !(c.year_to < p.year_from || c.year_from > p.year_to)
      );
      if (overlaps) continue;
      kept.push(c);
      prior.push(c);
      keptByGenre.set(g, prior);
      if (kept.length >= top_k) break;
    }

    ctx.ports.write({ candidates: kept });
    return `${kept.length} candidates (from ${candidates.length} raw cells) · max score ${kept[0]?.score ?? 0}`;
  },

  control: {
    window: { width: 760, height: 620 },

    data(ctx) {
      return (ctx.output.candidates as Candidate[] | undefined) ?? [];
    },

    render(ctx) {
      const cands = (ctx.data as Candidate[]) ?? [];
      const compact = ctx.surface === 'node';
      if (cands.length === 0) {
        return compact
          ? `${STYLE}<div class="sg-compact"><strong>SurfaceGroups</strong><p>pull upstream first</p>
  <button data-cocoon-event="$open">Open candidates ▸</button></div>`
          : `${STYLE}<div class="sg"><p class="empty">No candidates — pull EnrichMovies upstream.</p></div>`;
      }
      const top = cands[0];
      if (compact) {
        return `${STYLE}<div class="sg-compact">
  <strong>${cands.length} candidate groups</strong>
  <p>top: <b>${esc(top.name)}</b> · z=${top.score.toFixed(1)}</p>
  <button data-cocoon-event="$open">Open candidates ▸</button>
</div>`;
      }
      return `${STYLE}<div class="sg">
  <header class="head">
    <h1>Discovery — candidate groups</h1>
    <p class="sub">${cands.length} cells where genre concentration exceeds the baseline by a positive z-score. Copy the YAML block beside any row into <code>GenerateTopLists.conditions</code> to promote.</p>
  </header>
  <div class="rows">
    ${cands.map(renderRow).join('\n')}
  </div>
</div>`;
    },
  },
};

function renderRow(c: Candidate): string {
  const yamlSpec = [
    `- name: ${c.name}`,
    `  year_from: ${c.year_from}`,
    `  year_to: ${c.year_to}`,
    `  genres: [${c.genres.join(', ')}]`,
  ].join('\n');
  const ex = c.exemplars
    .slice(0, 4)
    .map(e => `${esc(e.title)} (${e.year})`)
    .join(' · ');
  return `<article class="row">
  <header>
    <h2>${esc(c.name)}</h2>
    <span class="score">z=<b>${c.score.toFixed(2)}</b></span>
  </header>
  <p class="stats">obs <b>${c.observed}</b> vs exp <b>${c.expected.toFixed(1)}</b> · baseline ${(c.baseline_share * 100).toFixed(1)}% → in-window ${(c.window_share * 100).toFixed(1)}%</p>
  <p class="ex">${esc(ex)}</p>
  <pre class="yaml">${esc(yamlSpec)}</pre>
</article>`;
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
.control .sg-compact { display:flex; flex-direction:column; gap:6px; }
.control .sg-compact strong { font-size:12px; color:#fb923c; }
.control .sg-compact p { margin:0; color:#9a9aa6; font-size:11px; font-variant-numeric:tabular-nums; }
.control .sg-compact p b { color:#c4b5fd; }
.control .sg-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }

.control .sg { display:flex; flex-direction:column; gap:10px; height:100%; color:#e7e7ea; font-size:11.5px; }
.control .sg .head h1 { margin:0; font-size:14px; color:#fb923c; }
.control .sg .head .sub { margin:2px 0 0 0; color:#9a9aa6; font-size:11px; line-height:1.5; }
.control .sg .head code { background:#1f1f27; padding:1px 4px; border-radius:3px; color:#c4b5fd; font-size:10.5px; }
.control .sg .empty { color:#9a9aa6; font-style:italic; padding:20px; text-align:center; }

.control .sg .rows { display:flex; flex-direction:column; gap:6px; overflow-y:auto; padding-right:6px; }
.control .sg .row { background:#15151b; border:1px solid #2a2a31; border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:4px; }
.control .sg .row header { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.control .sg .row header h2 { margin:0; font-size:12px; color:#c4b5fd; font-weight:600; }
.control .sg .row header .score { font-size:10.5px; color:#71717a; font-variant-numeric:tabular-nums; }
.control .sg .row header .score b { color:#fbbf24; }
.control .sg .row .stats { margin:0; color:#9a9aa6; font-size:10.5px; font-variant-numeric:tabular-nums; }
.control .sg .row .stats b { color:#e7e7ea; }
.control .sg .row .ex { margin:0; color:#a1a1aa; font-size:10.5px; }
.control .sg .row .yaml { margin:0; background:#0b0b0e; color:#86efac; padding:5px 7px; border-radius:4px; font-family:ui-monospace, Menlo, monospace; font-size:9.5px; line-height:1.4; user-select:all; white-space:pre; overflow-x:auto; }
</style>`;
