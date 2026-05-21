# BGG example — pickup notes

Showcase flow analysing a BGG user's rating bias vs the community. Built in
session `bgg-example`. See repo root `CLAUDE.md` for the platform model;
this file covers only what's specific to this flow.

## Current state

Five-node chain working end-to-end against live BGG data:

```
FetchCollection → ComputeDeltas → BiasReport
                                → DeltaScatter
                                → Shortlist
```

Verified findings for `username=quinns` (Quintin Smith, SU&SD), 475 games:
mean Δ +0.247, mildly penalises long playtimes (r=−0.17), mildly rewards
higher min-player-count (r=+0.18). No year/popularity bias.

Run with:

```sh
export BGG_COOKIE="bggusername=…; bggpassword=…; SessionID=…"
pnpm core serve examples/bgg/cocoon.yml
pnpm dev   # in another terminal
```

Cookies come from devtools after logging in to boardgamegeek.com; only
`/xmlapi2/collection` works with cookies (every other endpoint is now
behind a bearer token, even when logged in).

## Parked: enrichment + complexity dimension

`EnrichWithDetails` is a complete, tested node that batches
`/xmlapi2/thing?id=…&stats=1` to add `weight` (BGG complexity),
`mechanics`, `categories`, `designers` per game. It's wired in the source
but commented out of `cocoon.yml` because `/thing` returns 401 without a
registered-app bearer token, even with valid session cookies.

Complexity is the single most narratively powerful bias dimension
("does Quinns reward heavy games?") — re-enabling it is the obvious next
step once the token arrives.

## When the BGG token lands

App registration submitted in session `bgg-example`. The commitment in
the application:

- **Single registered app**, single bearer token, never in the repo.
- **Cocoon points at a proxy I host**, not at BGG directly, for `/thing`
  calls. The proxy holds the token, identifies via `User-Agent` with
  contact details, enforces ≤1 req/sec aggregate + per-IP throttling, and
  caches XML on hit.
- `/collection` keeps going direct-to-BGG with the user's own cookie
  (user-specific data, not the proxy's business).

### Pickup steps

1. **Stand up the proxy.** Tiny HTTP server (Hetzner/owl.si is fine —
   see Lynn's skill). Single endpoint, e.g.
   `GET https://bgg-proxy.<host>/thing?id=…&stats=…` →
   forwards to `https://boardgamegeek.com/xmlapi2/thing?…` with
   `Authorization: Bearer $BGG_TOKEN`, adds polite User-Agent, applies
   rate limit, caches by query string (1 day TTL is plenty).
   - Token in 1Password, injected at boot (never committed).
   - Health check + structured logs (request count, cache hit %, BGG
     status codes) so the rate-limit story is auditable.
   - Open-source the proxy alongside Cocoon (BGG was promised this).

2. **Re-point `EnrichWithDetails`.** In
   `nodes/EnrichWithDetails.ts`:
   - Swap `const THING_URL = 'https://boardgamegeek.com/xmlapi2/thing'`
     for the proxy URL (env var `BGG_PROXY_URL` with the public default).
   - Drop the `Cookie` header — the proxy adds the bearer; clients are
     anonymous.
   - Keep the batch size + sleep — they're polite-client patterns the
     proxy will appreciate too.
   - The 401-on-no-cookie error path should swap to "proxy unreachable"
     diagnostics.

3. **Re-wire the flow.** In `cocoon.yml`, uncomment EnrichWithDetails
   and change `ComputeDeltas.in.games` back to
   `cocoon://EnrichWithDetails/out/games`.

4. **Restore the complexity dimension.** In:
   - `nodes/BiasReport.ts` — add `{ key: 'weight', label: 'Complexity',
     unit: 'weight' }` back to `DIMS` (above the year entry).
   - `nodes/DeltaScatter.ts` — add `weight` back to `DIM_LABELS` and
     restore `default: 'weight'` on the dimension steering control.
   - Both files have `// Re-add once enrichment is wired back in.`
     markers at the cut sites.

5. **Verify.** Pull Shortlist end-to-end with the proxy live; expect
   `weight` in the bias table with a slope. If Quinns rewards complexity
   (which he plausibly does), the report's narrative-sentence builder
   will pick it up automatically.

6. **Sandbox cleanup.** Task #7 from session `bgg-example` was paused at
   this step. Remove `sandbox/{annotate,charts,csv-poc,rate,tagcloud}`
   and update the `Layout` paragraph in root `CLAUDE.md` to point at
   `examples/bgg/` instead of `sandbox/`.

## Quick architecture map

| File | Role | Notes |
|---|---|---|
| `cocoon.yml` | Flow wiring | EnrichWithDetails commented out (see above) |
| `nodes/FetchCollection.ts` | Source. `username` steering, 202-retry. | Cookie-only; one direct call to BGG |
| `nodes/EnrichWithDetails.ts` | **Parked.** Batched /thing calls. | Needs proxy URL swap |
| `nodes/ComputeDeltas.ts` | Pure transform. `benchmark` (avg/bayes), `minVoters` steering. | Adds `delta` + `summary` |
| `nodes/BiasReport.ts` | Render-only control (no event = "view"). | Linear-regression table + narrative |
| `nodes/DeltaScatter.ts` | Steering + ECharts hook. | CDN dep: `echarts@5.4.3` |
| `nodes/Shortlist.ts` | Action tier. `topN` steering + toggle event. | Side-file: `shortlist.json` |

## Don'ts

- Don't commit `BGG_COOKIE` or `BGG_TOKEN` to the repo. Cookie is a
  per-session leak; token is a license-revocation event.
- Don't make the proxy a generic BGG API tunnel. Whitelist `/thing`
  only — `/collection` belongs on the user's own cookie path.
- Don't drop the rate limit when caching is added. BGG was promised
  ≤1 req/sec aggregate; the cache earns nothing extra above that.
- Don't loosen the User-Agent contact details. BGG specifically said
  reachability matters; a missing UA is the fastest way to lose the app.
