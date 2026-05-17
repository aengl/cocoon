# clab — the AI debug-loop fixture

Not a capability example. This is the regression fixture for the **AI ↔ live
core session** (`core/introspect.ts`, `Runtime.peek`/`reload`, the on-throw
diagnostics). It deliberately reproduces the most common real failure class
from `tibi-old/boardgames.yml`:

`ImportBGGData` (`ReadJSON` here; `ReadCatirpelData` / 153k rows in prod) emits
`{ id, document }` where `document` is a **JSON string**. A first-pass custom
clustering node (`nodes/KMeans.ts`) naively reads `x.weight` / `x.rating` —
which live *inside* the unparsed `document` — so it throws on non-numeric
coordinates. `cocoon.yml` is the broken graph; `cocoon.fixed.yml` is the same
graph after the fix (insert a `Parse` `Map` that `JSON.parse`s `document`),
used by the reload test to simulate "the AI edited the flow, reload".

The loop the test drives: `process(Plot)` → error with stack + `inputDigest`
→ `peek` the input port (schema shows `document: json-string`, `--descend`
follows it in) → fix on disk → `reload` → `process` → `done` + a *bounded*
Scatterplot `viewData`. Every introspection response stays flat regardless of
row count — that is the property under test.
