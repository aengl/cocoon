import type { CocoonProcessNode } from '../../../core/contract.ts';

/**
 * Synthetic seed data for the charts example. Generates a fake board-game
 * catalogue and the seven derived shapes the chart demos consume. Pure
 * deterministic (seeded RNG) so the same pull always yields the same
 * pictures — easy to eyeball regressions.
 *
 * Why a single seed node instead of eight? Each chart needs a slightly
 * different shape and bound. Doing the projection once here keeps the
 * chart nodes thin (just the chart) and makes the shape contracts
 * explicit. The wire payload per chart stays small (≤2k records).
 *
 * Bounded outputs:
 *   - games        N=800 rows  (the source of truth)
 *   - flows        ~80 sankey edges across 3 levels
 *   - tidy         ~500 rows (10 facets × 50 rows)
 *   - distribution ~800 rows  (one per game, grouped by category)
 *   - points2d     ~800 rows  (rating × weight, coloured by category)
 *   - surface      50×50 z-matrix
 *   - timeseries   { n:1_000_000, seed:42 }  — hook generates the points
 *   - radar        5 categories × 6 metrics
 *   - network      ~120 nodes + ~280 edges
 */

const N_GAMES = 800;
const CATEGORIES = ['Strategy', 'Family', 'Party', 'Co-op', 'Wargame'] as const;
const DESIGNERS = [
  'Rosenberg', 'Knizia', 'Wallace', 'Lacerda', 'Feld',
  'Garfield', 'Faidutti', 'Chvátil', 'Vaccarino', 'Sinigaglia',
  'Pfister', 'Hamada', 'Pelek', 'Stegmaier', 'Lang',
  'Wehrle', 'McGerr', 'Daviau', 'Bauza', 'Cathala',
];
type Category = (typeof CATEGORIES)[number];

interface Game {
  id: string;
  name: string;
  category: Category;
  weight: number;
  rating: number;
  votes: number;
  year: number;
  designer: string;
}

export const SeedData: CocoonProcessNode = {
  category: 'Charts',
  description: 'Synthetic board-game catalogue + the shapes the chart demos read.',

  async *process(ctx) {
    const rng = mulberry32(20260526);
    const games: Game[] = [];
    for (let i = 0; i < N_GAMES; i++) {
      const cat = CATEGORIES[Math.floor(rng() * CATEGORIES.length)] as Category;
      const baseWeight = CATEGORY_BASE_WEIGHT[cat];
      const weight = clamp(baseWeight + (rng() - 0.5) * 1.6, 1, 5);
      // Rating is loosely correlated with weight (heavier ⇒ slightly higher mean)
      const rating = clamp(6.2 + (weight - 2.5) * 0.45 + (rng() - 0.5) * 1.6, 1, 10);
      const votes = Math.round(50 + rng() ** 3 * 6000);
      const year = 1995 + Math.floor(rng() * 30);
      const designer = DESIGNERS[Math.floor(rng() * DESIGNERS.length)] as string;
      games.push({
        id: `g${i.toString().padStart(4, '0')}`,
        name: `${cat[0]}${designer.slice(0, 4)}#${i}`,
        category: cat,
        weight: round(weight, 2),
        rating: round(rating, 2),
        votes,
        year,
        designer,
      });
    }

    ctx.ports.write({
      games,
      flows: buildFlows(games),
      tidy: buildTidy(games),
      distribution: buildDistribution(games),
      points2d: buildPoints2D(games),
      surface: buildSurface(),
      timeseries: { n: 1_000_000, seed: 42, label: '1M points' },
      radar: buildRadar(games),
      network: buildNetwork(games),
    });

    return `${games.length} games · ${CATEGORIES.length} categories · ${DESIGNERS.length} designers`;
  },
};

const CATEGORY_BASE_WEIGHT: Record<Category, number> = {
  Strategy: 3.4,
  Family: 1.9,
  Party: 1.6,
  'Co-op': 2.7,
  Wargame: 3.9,
};

// ---------------------------------------------------------------------------
// Derived shapes
// ---------------------------------------------------------------------------

interface SankeyFlow { source: string; target: string; value: number; }

function buildFlows(games: Game[]): { nodes: { name: string }[]; links: SankeyFlow[] } {
  // Three columns: designer → category → ratingBucket
  const ratingBucket = (r: number) =>
    r < 6 ? 'Rating <6' : r < 7 ? 'Rating 6–7' : r < 8 ? 'Rating 7–8' : 'Rating 8+';
  const sums = new Map<string, number>();
  const bump = (s: string, t: string) => sums.set(`${s}→${t}`, (sums.get(`${s}→${t}`) ?? 0) + 1);
  for (const g of games) {
    bump(g.designer, g.category);
    bump(g.category, ratingBucket(g.rating));
  }
  const links: SankeyFlow[] = [];
  const names = new Set<string>();
  for (const [k, value] of sums) {
    const [source, target] = k.split('→') as [string, string];
    if (value < 4) continue; // prune tiny links for legibility
    links.push({ source, target, value });
    names.add(source);
    names.add(target);
  }
  return { nodes: [...names].map(name => ({ name })), links };
}

interface TidyRow { facet: Category; x: number; y: number; year: number; }

function buildTidy(games: Game[]): TidyRow[] {
  // Slim per-game rows for faceted scatter — one panel per category.
  return games.slice(0, 600).map(g => ({
    facet: g.category, x: g.weight, y: g.rating, year: g.year,
  }));
}

interface DistRow { group: Category; value: number; id: string; name: string; }

function buildDistribution(games: Game[]): DistRow[] {
  // 1D distribution: rating by category — the beeswarm input.
  return games.map(g => ({ group: g.category, value: g.rating, id: g.id, name: g.name }));
}

interface Point2D { id: string; name: string; x: number; y: number; category: Category; year: number; }

function buildPoints2D(games: Game[]): Point2D[] {
  return games.map(g => ({
    id: g.id, name: g.name, x: g.weight, y: g.rating,
    category: g.category, year: g.year,
  }));
}

function buildSurface(): { z: number[][]; xLabels: string[]; yLabels: string[] } {
  // Synthetic rating landscape over weight (x, 50 steps 1..5) × year (y, 50 steps 1995..2025).
  const N = 50;
  const z: number[][] = [];
  for (let yi = 0; yi < N; yi++) {
    const yr = 1995 + (yi / (N - 1)) * 30;
    const row: number[] = [];
    for (let xi = 0; xi < N; xi++) {
      const w = 1 + (xi / (N - 1)) * 4;
      // Two gaussian bumps + a gentle weight trend
      const bump1 = Math.exp(-((w - 3.5) ** 2 + ((yr - 2018) / 6) ** 2) / 1.4);
      const bump2 = Math.exp(-((w - 1.8) ** 2 + ((yr - 2005) / 5) ** 2) / 1.6);
      row.push(round(6.4 + 1.6 * bump1 + 0.9 * bump2 + (w - 2.5) * 0.18, 3));
    }
    z.push(row);
  }
  return {
    z,
    xLabels: Array.from({ length: N }, (_, i) => round(1 + (i / (N - 1)) * 4, 2).toString()),
    yLabels: Array.from({ length: N }, (_, i) => Math.round(1995 + (i / (N - 1)) * 30).toString()),
  };
}

function buildRadar(games: Game[]): { metrics: string[]; series: { name: string; values: number[] }[] } {
  // Per-category mean of six metrics, each normalised to 0..1.
  const metrics = ['weight', 'rating', 'popularity', 'modernity', 'depth', 'fun'];
  const series = CATEGORIES.map(cat => {
    const rows = games.filter(g => g.category === cat);
    const n = rows.length || 1;
    const mean = (f: (g: Game) => number) => rows.reduce((a, g) => a + f(g), 0) / n;
    return {
      name: cat,
      values: [
        norm(mean(g => g.weight), 1, 5),
        norm(mean(g => g.rating), 5, 9),
        norm(Math.log10(1 + mean(g => g.votes)), Math.log10(50), Math.log10(6050)),
        norm(mean(g => g.year), 1995, 2025),
        norm(mean(g => g.weight * g.rating), 5, 36), // ad-hoc "depth"
        norm(mean(g => 10 - Math.abs(g.weight - 2.5) * 1.4), 5, 10), // ad-hoc "fun"
      ].map(v => round(v, 3)),
    };
  });
  return { metrics, series };
}

interface NetNode { id: string; label: string; group: string; weight: number; }
interface NetEdge { source: string; target: string; weight: number; }

function buildNetwork(games: Game[]): { nodes: NetNode[]; edges: NetEdge[] } {
  // Designers as nodes; an edge between two designers if both share ≥3 games
  // in the same category (a stand-in for "collaborated"). Weight = co-mentions.
  const nodes: NetNode[] = DESIGNERS.map(d => {
    const count = games.filter(g => g.designer === d).length;
    return { id: d, label: d, group: dominantCategory(games, d), weight: count };
  });
  const co = new Map<string, number>();
  // Bucket games by (category, year) and pair designers co-occurring in the bucket.
  const buckets = new Map<string, Set<string>>();
  for (const g of games) {
    const k = `${g.category}|${Math.floor(g.year / 5)}`;
    if (!buckets.has(k)) buckets.set(k, new Set());
    (buckets.get(k) as Set<string>).add(g.designer);
  }
  for (const designers of buckets.values()) {
    const arr = [...designers];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i] as string;
        const b = arr[j] as string;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        co.set(key, (co.get(key) ?? 0) + 1);
      }
    }
  }
  const edges: NetEdge[] = [];
  for (const [k, weight] of co) {
    if (weight < 3) continue;
    const [source, target] = k.split('|') as [string, string];
    edges.push({ source, target, weight });
  }
  return { nodes, edges };
}

function dominantCategory(games: Game[], designer: string): string {
  const counts = new Map<string, number>();
  for (const g of games) if (g.designer === designer) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
  let best: string = CATEGORIES[0];
  let bestN = -1;
  for (const [k, v] of counts) if (v > bestN) { best = k; bestN = v; }
  return best;
}

// ---------------------------------------------------------------------------

function mulberry32(a: number): () => number {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
