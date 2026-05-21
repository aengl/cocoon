import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Source node — one HTTP call to BoardGameGeek's `/xmlapi2/collection` for
 * a single user, parsed into a flat row-per-game array.
 *
 * Why this endpoint: it returns, for every game the user rated, BOTH the
 * user's own rating AND the community statistics (average, Bayesian, num
 * voters, players, playtime) in a single request. That's the whole basis
 * for the bias analysis downstream — the comparison is *within the same
 * set of games the user chose to rate*, which controls for selection.
 * Complexity (`weight`) is the one richly-bias-relevant field this
 * endpoint does NOT carry; `EnrichWithDetails` does a second pass.
 *
 * BGG's 202 dance: large collections aren't materialised on demand — the
 * server returns `202 Accepted` with a "queued, try again" body, the
 * client polls every few seconds until `200`. Faithful, bounded retry +
 * exponential-ish backoff. Persist caches the parsed JSON next to the
 * flow file so subsequent pulls are instant + offline.
 *
 * Symmetric-import: this node has no `hook`, so a top-level
 * `import type` is fine. Runtime deps (`fast-xml-parser`) are dynamic-
 * imported from a pinned CDN URL at the point of use (the rule still
 * applies — a future hook addition wouldn't have to refactor).
 */

interface Row {
  id: string;
  name: string;
  year: number | null;
  thumbnail: string;
  image: string;
  own_rating: number;
  community_avg: number;
  community_bayes: number;
  num_ratings: number;
  num_owned: number;
  playing_time: number | null;
  min_players: number | null;
  max_players: number | null;
}

const BGG_URL = 'https://boardgamegeek.com/xmlapi2/collection';
const MAX_RETRIES = 8;
const RETRY_BASE_MS = 2500;

export const FetchCollection: CocoonProcessNode = {
  category: 'BGG',
  description: 'Fetch a BGG user collection (rated games + community stats).',

  controls: {
    username: {
      kind: 'text',
      label: 'BGG username',
      default: 'quinns',
      placeholder: 'e.g. quinns, TomVasel, RahdoRuns',
    },
  },

  async *process(ctx) {
    const { username } = ctx.controls.read() as { username: string };
    const u = (username ?? '').trim();
    if (!u) throw new Error('username is empty — set the steering control');

    const url = `${BGG_URL}?username=${encodeURIComponent(u)}&stats=1&rated=1&subtype=boardgame`;
    ctx.debug('GET', url);

    const cookie = process.env.BGG_COOKIE ?? '';
    if (!cookie)
      throw new Error(
        'BGG_COOKIE env var not set — log in to boardgamegeek.com, copy the request cookies from devtools, then `export BGG_COOKIE="…"`'
      );
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (cocoon-bgg-example)',
      Cookie: cookie,
    };

    let xml: string | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      yield `request ${attempt}/${MAX_RETRIES}…`;
      const res = await fetch(url, { headers });
      if (res.status === 200) {
        xml = await res.text();
        break;
      }
      if (res.status === 202) {
        const delay = RETRY_BASE_MS * attempt;
        yield `queued (HTTP 202) — retry in ${Math.round(delay / 1000)}s`;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`BGG returned HTTP ${res.status} for ${u}`);
    }
    if (xml == null)
      throw new Error(`BGG never resolved after ${MAX_RETRIES} retries`);

    const { XMLParser } = (await import(
      'https://esm.sh/fast-xml-parser@4.5.0'
    )) as { XMLParser: new (opts: object) => { parse: (s: string) => unknown } };

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: true,
      isArray: (name: string) => name === 'item',
    });
    const parsed = parser.parse(xml) as {
      items?: { totalitems?: number; item?: BGGItem[] };
      errors?: unknown;
    };
    if (parsed.errors)
      throw new Error(`BGG returned errors for "${u}" — does the user exist?`);

    const items = parsed.items?.item ?? [];
    const rows: Row[] = items.map(parseItem).filter(r => r.own_rating > 0);

    ctx.ports.write({ games: rows, username: u });
    return `${rows.length} rated games for "${u}"`;
  },
};

// ---------------------------------------------------------------------------
// BGG XML → Row projection
// ---------------------------------------------------------------------------

interface BGGItem {
  objectid: string | number;
  name: string | { '#text'?: string };
  yearpublished?: string | number;
  image?: string;
  thumbnail?: string;
  stats?: {
    minplayers?: string | number;
    maxplayers?: string | number;
    playingtime?: string | number;
    numowned?: string | number;
    rating?: {
      value?: string | number;
      usersrated?: { value: string | number };
      average?: { value: string | number };
      bayesaverage?: { value: string | number };
    };
  };
}

const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  const n = num(v);
  return n === 0 ? null : n;
};

function parseItem(item: BGGItem): Row {
  const name =
    typeof item.name === 'string' ? item.name : (item.name?.['#text'] ?? '');
  const s = item.stats ?? {};
  const r = s.rating ?? {};
  return {
    id: String(item.objectid),
    name: String(name),
    year: numOrNull(item.yearpublished),
    thumbnail: String(item.thumbnail ?? ''),
    image: String(item.image ?? ''),
    own_rating: num(r.value),
    community_avg: num(r.average?.value),
    community_bayes: num(r.bayesaverage?.value),
    num_ratings: num(r.usersrated?.value),
    num_owned: num(s.numowned),
    playing_time: numOrNull(s.playingtime),
    min_players: numOrNull(s.minplayers),
    max_players: numOrNull(s.maxplayers),
  };
}
