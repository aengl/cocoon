# TMDB example — pickup notes

The headline showcase for **discovery + curation** as the Cocoon shape:
two co-equal halves connected by human/AI judgement, with a *produced*
output that didn't exist before the pull. Per-node what/why lives in the
`'?':` strings in `cocoon.yml` — this file covers only the cross-cutting
concerns (what the YAML can't say).

## Run + cold-pull cost

```sh
pnpm core serve examples/tmdb/cocoon.yml
pnpm dev   # in another terminal
```

First pull of `EnrichMovies` at defaults (1995–2024 US, vote_count ≥ 200)
fetches **~7300 candidates** then enriches each via `/movie/{id}` at
p-limit(8). Real-world: **~100 s** cold (≈70 req/s sustained, slower than
TMDB's documented ~40 rps soft cap because we're under it). Note that
`cocoon process` from the CLI has a 60 s default timeout — the server
keeps going, just poll `cocoon query node EnrichMovies` until `done`.

Both `DiscoverMovies` and `EnrichMovies` carry `persist: true` in YAML,
so the editor shows the orange disk at hello-time and every re-pull after
that is instant unless the steering knobs widen the candidate set
(narrowing is free — the cache is keyed by movie id).

## API key

`TMDB_API_KEY` env var, required (the source nodes throw a one-line
"how to get one" message if it's missing — same pattern as BGG_COOKIE
in the BGG example). It's a TMDB v3 read-access token, free + instant
to issue at <https://www.themoviedb.org/settings/api>; not a secret
credential, but personal — so it stays out of the repo.

```sh
export TMDB_API_KEY="<your key>"
pnpm core serve examples/tmdb/cocoon.yml
```

## The bridge (the load-bearing concept)

`SurfaceGroups` and `SurfaceRegions` produce **candidates**, not
verdicts. Each row in their window carries a pre-rendered YAML block
(`user-select:all` on the green box — one click selects the whole
spec). The human/AI promotes by pasting the block under
`GenerateTopLists.in.conditions:`, re-saving the YAML, re-pulling
GenerateTopLists. The materialised top-N is the artifact.

Promotion is deliberate by design — the *moment of judgement* is the
whole point. An event-tier "Promote" button (auto-appending to a
side-file the curation node also reads) is the obvious v2 if the YAML
round-trip turns out to feel heavy in practice; for now it's load-bearing
that the human signs off explicitly.

## Why the defaults are the way they are

- **`with_origin_country=US`**: the budget-mix story is specifically a
  Hollywood story. A global slice mixes in regional indie surges
  (Korea/India/Spain) and dilutes the headline. The flow is keyed to
  Hollywood.
- **`vote_count ≥ 200`**: selects for *films audiences actually saw*. A
  `≥ 0` cut drowns the picture in the micro-indie long tail and tells a
  different (also true) story. `≥ 100` or `≥ 500` are the other natural
  cuts; 200 is the comfortable middle.
- **Budget tiers** (`micro/low/mid/high/tentpole` at $5M / $20M / $60M /
  $150M): inflation-unadjusted on purpose — the Variety/THR pieces this
  shape rests on also use nominal dollars, and CPI-adjustment blunts the
  headline (production cost inflation > CPI).
- **`SurfaceRegions` default lens = `rating` on budget × rating**: lights
  up the obvious "higher budget rates slightly higher" gradient on first
  paint. The interesting findings (sleeper cells, money-pit cells) come
  from steering the axes + lens — see the embedded "things to play with"
  in the original sketch.

## Data-quality footguns (caught in session, worth knowing)

- **~30 % of enriched rows have `budget = 0`**. TMDB contributors haven't
  filled it in. Nodes that compute on budget filter these out; the
  `BudgetEvolution` chart treats them as "no signal" (counted in
  `totalRows`, excluded from shares). The bias is reasonably uniform
  across decades so the story is robust.
- **TMDB `popularity` decays over time**. It's a current/recent score,
  not a historical one. So the bottom-popularity quartile in any
  `SurfaceRegions` (axis=popularity) cut is mostly *aged-out blockbusters*
  (X-Men 2006–2011, Fast & Furious 5–6) that returned 2–5× at release —
  not real flops. Don't promote a "high-budget × low-popularity" cell as
  a flop list without re-checking against `vote_count` or release-era.
- **The Curiosity-vs-Mining-vs-Curation grouping is semantic, not
  structural**. The core has no concept of groups beyond visual
  clustering; everything routes through the same pull machinery. The
  groups are there to keep the canvas readable.

## Don'ts

- Don't drop `with_origin_country=US`. The story is Hollywood; widening
  it tells a different one.
- Don't add steering to `BudgetEvolution`. The chart is the fixed-shape
  default render; tunables go upstream where they prune the candidate
  set. The action surface lives in a *new* node, never the viz.
- Don't commit a personal TMDB key. The embedded one is the public demo
  key (shared, rate-limited); a personal key belongs in env vars or 1P.
- Don't gate processing on a callout being open. Callouts are presence,
  evaporate on disconnect / core restart, and never cross into the pull
  graph. Re-drop after any restart.

## Genuine next steps (deferred for later sessions)

1. **Cinderella poster grid** as a third Curiosity viz off
   `EnrichMovies` — top-N films by ROI per decade with their posters and
   an LLM-written one-line "why this surprised" caption. Touches the
   image-poster surface + an LLM-in-flow node.
2. **Genre filter as a `BudgetEvolution` steering knob** — does the
   tentpole rise hit drama hardest? (Yes, famously.) Single-select.
3. **Side-file output for `GenerateTopLists`** — write
   `top_lists.json` next to the flow on every pull (BGG `Shortlist`
   pattern). Makes the artifact externally consumable, not just
   port-bound. Cheap to add; deferred until someone actually wants the
   external file.
4. **Event-tier "Promote" button** on `SurfaceGroups` /
   `SurfaceRegions` candidates — appends the spec into the curation
   node's side-file (which `GenerateTopLists` would then also read).
   Removes the YAML round-trip if it ever turns out to feel heavy in
   practice. **Pre-condition: do #3 first**.
5. **Suggest-driven collab** — agent watches presence
   (`selectedNodes` / hovered cell), drops a callout like "1998 has only
   n=12 — widen vote_count gate?" or "this cell is mostly aged-out
   blockbusters — re-check with `min_vote_count` instead of
   `min_popularity`". Tightens the "agent reads what you're looking at"
   loop.
