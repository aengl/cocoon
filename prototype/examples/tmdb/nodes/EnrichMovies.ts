import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Enrichment node — for every row coming out of DiscoverMovies, hit
 * `/movie/{id}` to fold in fields the discover endpoint doesn't carry
 * (most importantly `budget` and `revenue`, plus `runtime`, `genres`,
 * `production_companies`, `original_language`). Persisted: the first cold
 * pull is the slow one (~30s for ≈3000 ids at p-limit(8)), every
 * subsequent re-pull serves from disk unless the input set widens.
 *
 * Concurrency: TMDB documents a ~40 req/s soft cap; we keep well below
 * at p-limit(8) so a multi-tab demo session doesn't trigger 429s. The
 * fetch retries 429 with linear backoff before giving up. Films that 404
 * or hard-fail are quietly dropped — TMDB occasionally retires ids — so
 * the output count may be slightly less than the input count.
 *
 * Symmetric-import: no `hook`, so `import type` at top is fine.
 * `p-limit` is dynamic-imported from a pinned CDN URL at the call site.
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

interface EnrichedRow extends DiscoverRow {
  budget: number;
  revenue: number;
  runtime: number | null;
  genres: string[];
  production_countries: string[];
  imdb_id: string | null;
}

interface TMDBMovie {
  id: number;
  budget?: number;
  revenue?: number;
  runtime?: number | null;
  imdb_id?: string | null;
  genres?: Array<{ id: number; name: string }>;
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
}

export const EnrichMovies: CocoonProcessNode = {
  category: 'TMDB',
  description: 'Per-id /movie/{id} enrichment — adds budget, revenue, runtime, genres.',

  async *process(ctx) {
    const { movies } = ctx.ports.read() as { movies?: DiscoverRow[] };
    const rows = Array.isArray(movies) ? movies : [];
    if (rows.length === 0) {
      ctx.ports.write({ movies: [] });
      return '0 rows — nothing to enrich';
    }

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey)
      throw new Error(
        'TMDB_API_KEY env var not set — get a free v3 key at https://www.themoviedb.org/settings/api, then `export TMDB_API_KEY="…"` before `pnpm core serve`.'
      );

    const pLimitMod = (await import('https://esm.sh/p-limit@5.0.0')) as {
      default: (n: number) => <T>(fn: () => Promise<T>) => Promise<T>;
    };
    const limit = pLimitMod.default(8);

    yield `enriching ${rows.length} ids…`;

    let done = 0;
    let dropped = 0;
    const enriched = await Promise.all(
      rows.map(row =>
        limit(async () => {
          try {
            const m = await fetchMovie(apiKey, row.id);
            done++;
            if (done % 50 === 0) ctx.debug(`enriched ${done}/${rows.length}`);
            const out: EnrichedRow = {
              ...row,
              budget: m.budget ?? 0,
              revenue: m.revenue ?? 0,
              runtime: m.runtime ?? null,
              genres: (m.genres ?? []).map(g => g.name),
              production_countries: (m.production_countries ?? []).map(
                c => c.iso_3166_1
              ),
              imdb_id: m.imdb_id ?? null,
            };
            return out;
          } catch (err) {
            dropped++;
            ctx.debug(`dropped id=${row.id} (${row.title}): ${String(err)}`);
            return null;
          }
        })
      )
    );

    const out = enriched.filter((r): r is EnrichedRow => r != null);
    ctx.ports.write({ movies: out });
    const withBudget = out.filter(r => r.budget > 0).length;
    return (
      `enriched ${out.length}/${rows.length}` +
      (dropped ? ` (${dropped} dropped)` : '') +
      ` · ${withBudget} have budget data`
    );
  },
};

async function fetchMovie(
  apiKey: string,
  id: number,
  retries = 4
): Promise<TMDBMovie> {
  const url = `${TMDB_API}/movie/${id}?api_key=${apiKey}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 200) return (await res.json()) as TMDBMovie;
    if (res.status === 429 && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 404) throw new Error(`404 (retired)`);
    if (attempt === retries - 1)
      throw new Error(`HTTP ${res.status} after ${retries} attempts`);
  }
  throw new Error(`exhausted retries`);
}
