import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Second-pass enrichment — the BGG collection endpoint doesn't carry
 * `averageweight` (a.k.a. complexity, the most bias-relevant field). This
 * node batches `/xmlapi2/thing?id=…&stats=1` calls and folds the extras
 * back into each row.
 *
 * Why a *separate* node: it isolates the "expensive, online" half from
 * the rest of the flow, so its persist cache is its own (drop the cache
 * here to re-enrich without re-fetching the collection), and steering
 * `batch` / `limit` is local to enrichment without affecting the source.
 *
 * BGG's `/thing` accepts comma-separated IDs in a single URL; in practice
 * 20 is the safe batch size. We sleep ~1.2s between batches to stay
 * polite — total runtime scales with the collection (~30s for 500 games),
 * but the cache fast-paths every subsequent pull.
 */

interface InputRow {
  id: string;
  [k: string]: unknown;
}

interface EnrichedRow extends InputRow {
  weight: number; // BGG average weight 1..5, 0 = none yet
  num_weights: number;
  categories: string[];
  mechanics: string[];
  designers: string[];
}

const THING_URL = 'https://boardgamegeek.com/xmlapi2/thing';
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1200;
const MAX_RETRIES = 6;

export const EnrichWithDetails: CocoonProcessNode = {
  category: 'BGG',
  description: 'Add weight + mechanics + categories by batching /thing calls.',

  controls: {
    limit: {
      kind: 'number',
      label: 'limit (0 = all)',
      default: 0,
      min: 0,
      max: 5000,
      step: 50,
    },
  },

  async *process(ctx) {
    const { games } = ctx.ports.read() as { games?: InputRow[] };
    const rows = Array.isArray(games) ? games : [];
    if (rows.length === 0) {
      ctx.ports.write({ games: [] });
      return 'no games to enrich';
    }

    const { limit } = ctx.controls.read() as { limit: number };
    const subset = limit > 0 ? rows.slice(0, limit) : rows;

    const { XMLParser } = (await import(
      'https://esm.sh/fast-xml-parser@4.5.0'
    )) as { XMLParser: new (opts: object) => { parse: (s: string) => unknown } };
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: true,
      isArray: (name: string) =>
        name === 'item' || name === 'link' || name === 'name',
    });

    const cookie = process.env.BGG_COOKIE ?? '';
    if (!cookie)
      throw new Error(
        'BGG_COOKIE env var not set — see FetchCollection for the instructions'
      );
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (cocoon-bgg-example)',
      Cookie: cookie,
    };

    const details = new Map<string, ThingDetail>();
    const batches = chunk(
      subset.map(r => r.id),
      BATCH_SIZE
    );

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      yield [`batch ${bi + 1}/${batches.length}`, (bi + 1) / batches.length];
      const url = `${THING_URL}?id=${batch.join(',')}&stats=1`;
      ctx.debug('GET', url);

      let xml: string | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const res = await fetch(url, { headers });
        if (res.status === 200) {
          xml = await res.text();
          break;
        }
        if (res.status === 202 || res.status === 429) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }
        throw new Error(`BGG /thing returned HTTP ${res.status}`);
      }
      if (xml == null)
        throw new Error('BGG /thing never resolved — retries exhausted');

      const parsed = parser.parse(xml) as {
        items?: { item?: ThingItem[] };
      };
      for (const it of parsed.items?.item ?? []) {
        details.set(String(it.id), projectDetail(it));
      }

      if (bi < batches.length - 1)
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    const enriched: EnrichedRow[] = subset.map(r => {
      const d = details.get(String(r.id)) ?? EMPTY_DETAIL;
      return {
        ...r,
        weight: d.weight,
        num_weights: d.num_weights,
        categories: d.categories,
        mechanics: d.mechanics,
        designers: d.designers,
      };
    });

    const withWeight = enriched.filter(r => r.weight > 0).length;
    ctx.ports.write({ games: enriched });
    return `enriched ${enriched.length} (${withWeight} with weight)`;
  },
};

// ---------------------------------------------------------------------------
// /thing XML → detail projection
// ---------------------------------------------------------------------------

interface ThingItem {
  id: string | number;
  link?: { type: string; value: string }[];
  statistics?: {
    ratings?: {
      averageweight?: { value: string | number };
      numweights?: { value: string | number };
    };
  };
}

interface ThingDetail {
  weight: number;
  num_weights: number;
  categories: string[];
  mechanics: string[];
  designers: string[];
}

const EMPTY_DETAIL: ThingDetail = {
  weight: 0,
  num_weights: 0,
  categories: [],
  mechanics: [],
  designers: [],
};

const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function projectDetail(item: ThingItem): ThingDetail {
  const links = Array.isArray(item.link) ? item.link : [];
  const byType = (t: string) =>
    links.filter(l => l.type === t).map(l => String(l.value));
  const ratings = item.statistics?.ratings ?? {};
  return {
    weight: num(ratings.averageweight?.value),
    num_weights: num(ratings.numweights?.value),
    categories: byType('boardgamecategory'),
    mechanics: byType('boardgamemechanic'),
    designers: byType('boardgamedesigner'),
  };
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
