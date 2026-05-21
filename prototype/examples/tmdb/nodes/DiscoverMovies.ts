import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Source node — paginates TMDB's `/discover/movie` across a year range
 * (with `vote_count >= min_vote_count` and `with_origin_country=US`) into
 * a flat row-per-movie list. This is the *light* pass: it returns only
 * what `/discover` carries natively (no budget/revenue — those live behind
 * a per-id `/movie/{id}` call done by EnrichMovies downstream).
 *
 * Why steering only goes this far: the year range and the vote-count gate
 * define the candidate set we're going to enrich, and enrichment is the
 * expensive step. Letting the human prune *before* enrichment keeps the
 * cold-pull cost honest. Concurrency: TMDB paginates 20 results/page with
 * a hard 500-page cap per query, so we slice by year (each year stays
 * well under 500 pages for any reasonable vote-count gate) and fan pages
 * out with p-limit(6) — comfortably under TMDB's documented ~40 req/s
 * upper bound.
 *
 * Symmetric-import rule: no `hook` here, so a top-level `import type` is
 * allowed; the runtime dep (`p-limit`) is dynamic-imported from a pinned
 * CDN URL inside `process()`.
 */

const TMDB_API = 'https://api.themoviedb.org/3';

interface DiscoverRow {
  id: number;
  title: string;
  release_date: string;
  release_year: number;
  popularity: number;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  original_language: string;
  poster_path: string | null;
}

interface DiscoverResp {
  page: number;
  total_pages: number;
  total_results: number;
  results: Array<{
    id: number;
    title: string;
    release_date?: string;
    popularity: number;
    vote_average: number;
    vote_count: number;
    genre_ids: number[];
    original_language: string;
    poster_path: string | null;
  }>;
}

export const DiscoverMovies: CocoonProcessNode = {
  category: 'TMDB',
  description: 'Paginate TMDB /discover/movie for a year range (US-origin).',

  controls: {
    year_from: {
      kind: 'number',
      label: 'first year',
      default: 1995,
      min: 1900,
      max: 2030,
      step: 1,
    },
    year_to: {
      kind: 'number',
      label: 'last year',
      default: 2024,
      min: 1900,
      max: 2030,
      step: 1,
    },
    min_vote_count: {
      kind: 'number',
      label: 'min vote_count',
      default: 200,
      min: 0,
      max: 10000,
      step: 50,
    },
  },

  async *process(ctx) {
    const { year_from, year_to, min_vote_count } = ctx.controls.read() as {
      year_from: number;
      year_to: number;
      min_vote_count: number;
    };
    if (year_from > year_to)
      throw new Error(`year_from (${year_from}) > year_to (${year_to})`);

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey)
      throw new Error(
        'TMDB_API_KEY env var not set — get a free v3 key at https://www.themoviedb.org/settings/api, then `export TMDB_API_KEY="…"` before `pnpm core serve`.'
      );

    const years: number[] = [];
    for (let y = year_from; y <= year_to; y++) years.push(y);

    // Round 1: fetch page 1 per year to learn page counts.
    const headers = await Promise.all(
      years.map(y => fetchDiscover(apiKey, y, 1, min_vote_count))
    );

    type Job = { year: number; page: number };
    const jobs: Job[] = [];
    for (let i = 0; i < years.length; i++) {
      const h = headers[i];
      // total_pages is capped at 500 by TMDB; sane year-slices stay well below.
      const pages = Math.min(h.total_pages, 500);
      for (let p = 2; p <= pages; p++) jobs.push({ year: years[i], page: p });
    }

    yield `discovered ${headers.reduce((s, h) => s + h.total_results, 0)} candidate rows across ${years.length} years — fetching ${jobs.length} more pages…`;

    // Pinned CDN dep — dynamic-imported at the point of use.
    const pLimitMod = (await import('https://esm.sh/p-limit@5.0.0')) as {
      default: (n: number) => <T>(fn: () => Promise<T>) => Promise<T>;
    };
    const limit = pLimitMod.default(6);

    let done = 0;
    const rest = await Promise.all(
      jobs.map(j =>
        limit(async () => {
          const r = await fetchDiscover(apiKey, j.year, j.page, min_vote_count);
          done++;
          if (done % 20 === 0) ctx.debug(`page ${done}/${jobs.length}`);
          return r;
        })
      )
    );

    // Flatten + project to a stable row shape. Dedupe by id (a film can
    // briefly show under multiple years if release dates shift; first wins).
    const seen = new Map<number, DiscoverRow>();
    const collect = (year: number, r: DiscoverResp) => {
      for (const m of r.results) {
        if (seen.has(m.id)) continue;
        const releaseYear = m.release_date
          ? Number(m.release_date.slice(0, 4))
          : year;
        seen.set(m.id, {
          id: m.id,
          title: m.title,
          release_date: m.release_date ?? '',
          release_year: Number.isFinite(releaseYear) ? releaseYear : year,
          popularity: m.popularity,
          vote_average: m.vote_average,
          vote_count: m.vote_count,
          genre_ids: m.genre_ids ?? [],
          original_language: m.original_language,
          poster_path: m.poster_path,
        });
      }
    };
    for (let i = 0; i < years.length; i++) collect(years[i], headers[i]);
    for (let i = 0; i < jobs.length; i++) collect(jobs[i].year, rest[i]);

    const movies = [...seen.values()].sort(
      (a, b) => a.release_year - b.release_year || b.popularity - a.popularity
    );

    ctx.ports.write({ movies });
    return `${movies.length} unique movies · ${year_from}–${year_to} · vote_count ≥ ${min_vote_count}`;
  },
};

async function fetchDiscover(
  apiKey: string,
  year: number,
  page: number,
  minVoteCount: number,
  retries = 4
): Promise<DiscoverResp> {
  const url =
    `${TMDB_API}/discover/movie?api_key=${apiKey}` +
    `&primary_release_year=${year}` +
    `&vote_count.gte=${minVoteCount}` +
    `&sort_by=popularity.desc` +
    `&with_origin_country=US` +
    `&page=${page}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 200) return (await res.json()) as DiscoverResp;
    if (res.status === 429 && attempt < retries - 1) {
      const wait = 1500 * (attempt + 1);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    throw new Error(
      `TMDB /discover returned HTTP ${res.status} for year=${year} page=${page}`
    );
  }
  throw new Error(`TMDB /discover exhausted retries for year=${year} page=${page}`);
}
