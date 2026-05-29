# Writing nodes (and controls)

Companion to `SKILL.md`. Read after the main skill — this assumes you already know the keystones (pull graph, presence vs durable I/O, the ephemeral overlay vs durable I/O split, etc.) AND that you know how to locate the Cocoon repo (SKILL.md's "Finding the Cocoon repo" note). The whole guide is grounded in real examples under `examples/bgg/nodes/` and `examples/tmdb/nodes/` inside that repo; when in doubt, **read those files** — the node source is the contract.

## Where a node lives

One `.ts` file under one of the resolved roots:

- `<flowdir>/nodes/<Type>.ts` (next to `cocoon.yml`), or
- a dir declared in the flow's `nodeDirs:` list.

The file exports one symbol whose **name equals the filename** (`type:` in YAML resolves by convention):

```ts
// nodes/DiscoverMovies.ts
import type { CocoonProcessNode } from '<path>/core/contract.ts';

export const DiscoverMovies: CocoonProcessNode = { /* … */ };
```

There is no `index.ts` re-export step, no registry. Renaming the file renames the type. A duplicate type name across roots is a hard error.

## The contract in one breath

```ts
interface CocoonProcessNode {
  category?: string;        // free-text label (semantic only)
  description?: string;     // shown in the editor toolbar/inspector
  controls?: Record<string, ControlSchema>;   // steering knobs (inline)
  control?: ControlRender;                     // free-form control (HTML)
  process(ctx): AsyncGenerator<Progress, string | void, void>;
}
```

Every node has `process`. Controls are optional and independent: a node may carry steering knobs, a free-form control, both, or neither. A node may also export `const hook` (browser-side renderer) — that's the third, co-located file (same module).

## 1 — `process`: the pure transform

`process` is an **async generator**. It reads inputs (literal `in:` params + resolved upstream ports), reads its steering controls if it declared any, computes, writes outputs, optionally yields progress, and returns a one-line summary string shown in the node footer.

The shape that recurs across every real-world node:

```ts
import { z } from 'zod';

const Inputs = z.object({ data: z.array(Row), key: z.string() });
const Knobs  = z.object({ topN: z.number().int().positive() });

async *process(ctx) {
  const { data, key } = ctx.ports.read(Inputs);     // validated at the seam
  const { topN } = ctx.controls.read(Knobs);

  yield `processing ${data.length} rows…`;        // optional progress

  const out = data.slice(0, topN);

  ctx.ports.write({ data: out });
  return `${out.length}/${data.length} kept`;     // shown in node footer
}
```

Things to know:

- **`ctx.ports.read(schema?)` is your inputs (literals + edges merged).** A multi-edge input (`in: [cocoon://A/out/x, cocoon://B/out/y]`) arrives pre-flattened with `Array.flat()` depth 1 — never re-flatten in the node. **Pass a zod schema** to get typed, runtime-validated inputs in one go: a shape mismatch throws and surfaces as the node's `error` (which blocks downstream — exactly what you want). Without a schema you get `Record<string, unknown>` and have to narrow yourself.
- **`ctx.ports.write({ … }, schema?)` is your outputs.** A key written here becomes an output port and may be referenced by downstream `cocoon://` edges. An optional zod schema as the second arg validates the outputs before they cross the wire — useful for guarding against drift in long-running flows.
- **`ctx.controls.read(schema?)` is your steering values** — defaults merged with the live runtime overlay. Available only if you declared `controls:`. The same schema treatment applies.
- **Yield progress sparingly.** A yielded string shows in the node footer during run; a yielded number 0..1 drives the running animation. Don't yield on every row — emit at coarse milestones.
- **Return a tight one-line summary.** It becomes the node's resting status text (`"475 games · mean Δ +0.247"`). This is what someone reads on the canvas without opening anything.
- **Throw on real failures.** A thrown error becomes the node's `error` status and blocks downstream. Use a one-line, actionable message — `examples/tmdb/nodes/EnrichMovies.ts` checks for `TMDB_API_KEY` and throws with the URL to get one. Don't `try { … } catch { return [] }` away real problems.
- **Quiet failures should call `ctx.debug(…)`.** A row that's just bad data (TMDB 404, parse error on one record) gets logged and dropped, not thrown.
- **The symmetric-import rule** (load-bearing if the same file also exports a `hook`): top-level imports are limited to `import type` and relative `./` paths. Every npm bare specifier, every `node:*` builtin, every CDN URL is `await import(…)` inside `process` / `control.*` / `hook.mount`. CDN deps are pinned at the call site:
  ```ts
  const pLimit = (await import('https://esm.sh/p-limit@5.0.0')).default;
  ```

### Don't freeze the UI

The core runs on **one event loop**, shared with the WS transport. A node that holds it synchronously freezes the *whole* canvas — no repaint, new clients can't even connect — until `process` returns. `ctx.breathe(ms?)` hands the loop back.

- **CPU sweep** (big `map`/`sort`/`parse`/regex over many items) blocks atomically — chunk it and breathe:
  ```ts
  for (let i = 0; i < rows.length; i++) {
    out.push(score(rows[i]));
    if (i % 5000 === 0) await ctx.breathe();        // defer past pending I/O
  }
  ```
- **Progress trapped behind one big `await`.** `yield` is the *only* progress channel; while the generator is parked on a long await it emits nothing, so the node *looks* frozen even when the loop is fine. Classic case: a worker pool behind `await Promise.all(...)`. Drive it with a heartbeat:
  ```ts
  let done = 0;                                       // each worker bumps `done`
  const pool = Promise.all(lanes.map(work)).then(() => 'done');
  while ((await Promise.race([pool, ctx.breathe(500)])) !== 'done')
    yield `${done}/${total}`;                         // live progress every 500ms
  ```

An indivisible sync call you don't control (a 200 MB `JSON.parse`) can't be chunked — split or stream the work upstream instead.

### Resolving file paths

The core does **not** `chdir` to the flow dir. Use `ctx.resolvePath(...)` for anything filesystem-y:

```ts
const fullPath = ctx.resolvePath(SHORTLIST_PATH);   // flow-relative
const homePath = ctx.resolvePath('~/data/x.json');  // ~ expands to $HOME
const flowDir  = ctx.resolvePath();                  // no args ⇒ flow dir
```

### Durable side-files vs the pull graph

Many bespoke nodes own a durable side-file (annotations, shortlists, ratings). The pattern:

1. The control's `event` handler **writes the file** (the durable truth) and calls `ctx.markStale()`.
2. The control's `data` half **re-reads** the file every cycle so the UI stays live without re-running `process`.
3. `process` reads the same file and **folds** it into the output on a pull (the *commit*).

Don't try to stash durable state in the control's opaque blob; that's for unsaved drafts only.

## 2 — Steering controls (the inline knobs)

These are typed, code-declared, schema-checked, rendered inline on the node by the editor. State is an ephemeral runtime overlay (never YAML, resets on restart). Setting one is **pure pull**: node → `stale`, user re-pulls, `process` reads the new value via `ctx.controls.read()`.

The whole vocabulary — four `kind`s, defined as `ControlSchema` in `src/lib/protocol.ts`:

```ts
{ kind: 'toggle', label?, default? }                    // boolean
{ kind: 'select', label?, options: string[], default? } // enum
{ kind: 'text',   label?, default?, placeholder?, multiline? }
{ kind: 'number', label?, default?, min?, max?, step? }
```

Rules:

- **Steering changes data, not presentation.** If a knob changes the *emitted* values (which rows are kept, what's binned, the dimension on the x-axis), it's a steering control on `process`. If it only changes how the data is drawn (size, palette), it's not a knob — bake it in.
- **A knob's value only reaches `process`.** `ControlContext` has no `controls.read()`. To surface a knob in a viz, route it through `process` to `ctx.output`, which the control then reads. This coupling *is* the pull graph.
- **Validate at the read site.** The `ControlSchema` declaration constrains the kind + bounds, but a malicious or stale `set-control` can still arrive — pass a zod schema to `ctx.controls.read(Schema)` and/or clamp inside `process`/`data` (cf. `clampN()` in `examples/bgg/nodes/Shortlist.ts`). Zod is a core Cocoon dep, so `import { z } from 'zod'` works from any node without a CDN pin.

## 3 — Free-form controls (`control: { data, render, event }`)

The action tier. The node ships HTML (and optionally a browser hook), which a generic shim mounts. There is **no schema** — the node *is* the contract.

Three pure halves, all on the Node side:

```ts
control: {
  window: { width: 580, height: 700 },   // optional initial window size

  async data(ctx) {
    // 1) DERIVE a bounded payload from inputs + ctx.output + durable files.
    //    Recomputed after process() AND every control event.
    //    Whatever you return streams as `controlData` to the agent + hook.
    return { rows: rows.slice(0, MAX), summary };
  },

  render(ctx) {
    // 2) RETURN HTML from ctx.data (+ ctx.surface).
    //    Pure, sync, no I/O. Inline a <style>. Branch on ctx.surface.
    const d = ctx.data as Foo;
    if (ctx.surface === 'node') return `${STYLE}<div>compact…</div>`;
    return `${STYLE}<div>roomy…</div>`;
  },

  async event(ctx, ev) {
    // 3) HANDLE a posted event. Write the durable file, optionally
    //    ctx.control.set(...) the draft, optionally ctx.markStale().
    //    NEVER re-run process; the core re-derives data() and re-renders.
    if (ev.event === 'toggle') { /* … */ ctx.markStale(); }
  },
},
```

### Render

- **Two surfaces, one render.** Branch on `ctx.surface === 'node'` (the compact inline render — tight budget, usually a summary + an "Open ▸" button) vs `'window'` (roomy detached). One render fn, two outputs.
- **The `$open` button.** A `<button data-cocoon-event="$open">` opens the detached window. `$`-prefixed events are client-reserved — they never reach your `event` handler.
- **Inline your own `<style>`** (see styling section below). Scope every selector under `.control .<your-root>` so co-resident windows don't collide.
- **HTML-escape every author-provided string** that lands inside attrs or text. Every real node carries a 6-line `esc()` helper — copy it.
- **Hidden inputs are wiring, not drafts.** A form's `name="id"` hidden field rides along on submit; the shim skips hidden fields when collecting drafts for presence.

### Events

The browser shim wires interactivity by **attribute convention**:

| Attribute | Trigger | Payload |
|---|---|---|
| `<form data-cocoon-event="X">` | form submit | every named field in the form |
| `<button type="submit" data-cocoon-event="X">` *(inside a form)* | submit | form fields + the clicked button's name/value |
| `<button type="button" data-cocoon-event="X">` *(outside a form)* | click | `{}` (or the enclosing form's fields if any) |
| `<a/div/img/… data-cocoon-event="X">` | click | enclosing form's fields, or `{}` |

Special events:

- **`$mount`** — fired by the core when a surface (inline or detached window) first appears. Your `event` handler is *skipped* by default for it; if you opt in by checking `ev.event === '$mount'`, keep the handler idempotent. The window can be reopened.
- **`$open`** — the open-window button. Handled by the editor; never reaches your handler.

The `event` handler runs Node-side. It typically:

1. Writes the node's durable side-file (the truth).
2. Optionally `ctx.control.set({ … })` to update an unsaved draft (e.g. a search query — see `sandbox/rate/nodes/RateGames.ts` for the only legit use of this).
3. `ctx.markStale()` if the file change should age the node downstream. A search-style event that only updates a draft does **not** mark stale — it's presentation, not graph state.

### Data

`control.data` is your derivation half. It's recomputed after every event and after every process. **Keep it bounded** — the payload streams to the agent as `controlData`, and to the browser hook as `props.data`. A 150k rows table never crosses the wire; sample it.

- **Read `ctx.output.<port>`** for the "frozen pull output" — a snapshot of what `process` last wrote. This is what couples a viz to its upstream steering knobs (cf. `examples/bgg/nodes/DeltaScatter.ts`).
- **Read `ctx.ports.read(schema?)`** for the live inputs (same as `process` — same optional zod schema).
- **Read your durable file directly** for the parts that should stay live between pulls (cf. `examples/bgg/nodes/Shortlist.ts`, `sandbox/rate/nodes/RateGames.ts`).
- **Never cache derived state.** Re-derive it every cycle from the durable truth. Every cached-derived-state bug in this model came from caching.

### Window size

`control: { window: { width, height } }` is the **initial** window size. Once the user resizes, their size wins for the window's lifetime. Pick a size that fits the roomy render — `examples/bgg/nodes/Shortlist.ts` is 580×700 (vertical list), `examples/bgg/nodes/DeltaScatter.ts` is 720×560 (landscape chart).

## 4 — The browser hook (`export const hook`)

The *only* node code that runs in the browser. One per node module. The core esbuild-bundles only this export and serves it; the Node-side `process`/`control` is tree-shaken out.

```ts
export const hook: ControlHook<MyData> = {
  mount(el, props) {
    // create your DOM into `el`, draw with props.data
    // load CDN deps INSIDE mount() — never at top level
    let data = props.data;

    return {
      update(next) { data = next.data; redraw(); },
      destroy()   { /* tear down */ },
    };
  },
};
```

When the shim sees `<div data-cocoon-hook="…"></div>` in your rendered HTML, it calls `mount()` for each match. On every subsequent `controlData` update *without* an HTML swap, the shim calls `update(next)` in place — the canvas/chart instance survives. An HTML swap (e.g. you wrote different markup) tears down + remounts; design so the bulk of churn rides in `controlData`, not the HTML.

Rules:

- **Pin CDN deps at the call site.** `import('https://esm.sh/foo@1.2.3')` inside `mount`. Different nodes in the same flow can pin different versions; no coordination needed.
- **Make the hook self-size.** Use `ResizeObserver` on the container; the shim does not feed back resize events.
- **Tear down cleanly in `destroy()`.** Disconnect observers, dispose chart instances, remove DOM. The hook *will* be unmounted (window close, full HTML swap).
- **Defensive `min-height`** on the mount root: the inline compact surface can be tiny, and a hook with no height is invisible.
- **Handle "data not ready yet" inside `mount`** — `controlData` may arrive *after* the hook mounts, especially before the first pull. Cf. the `if (!echarts || !data?.ready) return` pattern in `examples/bgg/nodes/DeltaScatter.ts`.

## 5 — Dark theme: defaults you already have

`src/lib/CocoonNode.svelte` ships generic dark-theme defaults for `.control` content. **Use them.** A control with no styling already looks right.

What you get for free under `:global(.control …)`:

| Selector | What it gives you |
|---|---|
| `.control` | dark panel: `background:#1c1c20`, `border-top:1px solid #27272a`, `padding:8px 10px` |
| `.control form` | flex column, `gap:6px` |
| `.control label` | flex column, `gap:3px`, label text `color:#c4b5fd` (violet) |
| `.control input`, `.control select`, `.control textarea` | dark input, `background:#0d0d0f`, border `#3f3f46`, focus border `#8b5cf6` |
| `.control textarea` | + monospace, vertical resize |
| `.control button` | dark button, hover lifts to `#3f3f46`/`#fff` |
| `.control .row` | flex row, `gap:6px` (use for button rows) |
| `.control .control-error` | red error text (`#fca5a5`) |
| `.control h3` | `font-size:14px; color:#f4f4f5` |
| `.control p` | muted body text, `color:#a1a1aa; font-size:10.5px` |

The minimal Annotate-style form needs zero CSS. Reach for inline `<style>` only when you have node-specific structure (cards, tables, charts, lists, search bars, etc.).

## 6 — The palette (use these, not your own)

The codebase converges on Tailwind's zinc + a small accent set. Pick values from these, don't introduce new ones — every example node above is using exactly this palette.

**Surfaces** (darkest to lightest):
- `#0d0d0f` — deep input background
- `#18181b` — node body
- `#1c1c20` — control panel
- `#212128` — inset card (cf. `examples/bgg/nodes/Shortlist.ts` `.card`, `examples/bgg/nodes/BiasReport.ts` `.card`)
- `#27272a` — secondary surface, header background
- `#3f3f46` — borders, hover backgrounds

**Text** (loudest to quietest):
- `#f4f4f5` — h3 title
- `#e4e4e7` / `#e7e7ea` — body text
- `#d4d4d8` — emphasised body
- `#a1a1aa` / `#9a9aa6` — muted / metadata
- `#71717a` — secondary metadata / hints
- `#52525b` — disabled / placeholder

**Accents**:
- `#8b5cf6` (violet) — focus, primary action, pick/picked state
- `#c4b5fd` (lavender) — label text in controls, code identifiers
- `#a5b4fc` (indigo) — table dim labels
- `#fbbf24` (amber) — highlight / warning / freshness / "look here"
- `#fb923c` (orange) — heading / brand-y
- `#22c55e` / `#4ade80` (green) — success / done / "on" state
- `#f87171` / `#fca5a5` (red) — error / negative delta
- `#22d3ee` (cyan) / `#f97373` (coral) — positive / negative pair in charts (see `examples/bgg/nodes/Shortlist.ts`)
- `#93c5fd` (blue) — links

**Status colours** (set on the node by `src/lib/CocoonNode.svelte`, don't redefine): queued `#3b82f6` · running `#f59e0b` · done `#22c55e` · stale `#eab308` · error `#ef4444`.

## 7 — Best practices

**Naming.** Filename = exported symbol = `type:` in YAML. The flow's canvas label uses the node id (the YAML key), not the type. Choose verbs for transforms (`examples/bgg/nodes/ComputeDeltas.ts`, `examples/tmdb/nodes/EnrichMovies.ts`), nouns for data sources (`examples/tmdb/nodes/DiscoverMovies.ts`), and what-it-shows for viz (`examples/bgg/nodes/DeltaScatter.ts`, `examples/bgg/nodes/BiasReport.ts`).

**Pure transforms first.** Push complexity into `process` where possible. A control whose `data` just reads `ctx.output` and slices is the easiest to reason about. The `examples/bgg/nodes/BiasReport.ts` exception (stats live in `data` because nothing downstream consumes them) is conscious; you should be deliberate about it too.

**One node, one job.** Don't conflate "fetch + map" into one node — split, wire, persist the expensive half.

**Persist the expensive half.** Set `persist: true` in YAML on nodes whose cold pull takes more than a second or two (network, file parse, heavy compute). The persist cache file lands in `_cocoon_cache/` next to the flow. Persist toggle state itself is a runtime overlay, not YAML.

**Errors should diagnose.** "TMDB_API_KEY not set — get a free v3 key at https://… then `export TMDB_API_KEY=…`" beats "missing key". The error lands in `query node` for the agent and in the node footer for the human.

**`ctx.debug` is your debug log.** It streams to `cocoon serve`'s stdout plus the node's debug surface. Use it for the things that should be quiet by default — dropped rows, retries, file I/O paths.

**Bound everything that streams.** `controlData`, `peek` payloads, schema digests — they all cross the wire. A 150k-row port already has schema-only treatment; your `control.data` payload needs the same discipline. Cap with a constant at the top of the file:
```ts
const MAX_TAGS = 60;
const MAX_ROWS = 30;
const BATCH = 5;
```

**Render-only = a "View".** A control with `data` + `render` and **no** `event` is exactly what the legacy `view:` subsystem was — keep it event-less to communicate "this is a viz, not an actionable form."

## 8 — Design considerations for the dark theme

**Branch surfaces aggressively.** The compact node surface is ~240px wide × ~80–140px tall. The window surface is hundreds of px on a side. A single render that "just works at both sizes" almost always looks bad at one of them.

The compact pattern that recurs across every real example:

```html
<div class="<name>-compact">
  <strong>${label}</strong>
  <p>${one-line summary, the one number that matters}</p>
  <button data-cocoon-event="$open">Open ${name} ▸</button>
</div>
```

Heading in orange (`#fb923c`), summary muted, single CTA.

**The window surface uses cards.** The pattern: an `.head` block (title `#fb923c`, subhead muted), then one or more `.card` blocks (background `#212128`, border `#303039`, radius 10, padding 12–16). Each card has a uppercase tracking-wide muted `<h2>` label. Cf. `examples/bgg/nodes/BiasReport.ts`, `examples/bgg/nodes/Shortlist.ts`.

**Tables — tabular figures.** `font-variant-numeric: tabular-nums` on any numeric column. Right-align numbers, left-align text. Header row gets `text-transform:uppercase; letter-spacing:.07em; font-weight:700; color:#9a9aa6; font-size:9.5px`.

**Delta sign in colour.** `+` deltas go cyan (`#22d3ee`), `−` deltas coral (`#f97373`). Keep the `+`/`−` sign visible — don't strip it.

**Hairlines.** Internal dividers `1px solid #27272a` (subtler) or `#3f3f46` (stronger). Avoid heavy borders.

**No CSS frameworks, no CSS-in-JS, no Tailwind in node CSS.** A node ships its `<style>` block as a string inside the rendered HTML. Plain CSS, scoped under `.control .<root>`. The mount is idempotent across re-renders (CSSOM dedupes by selector text — same `<style>` injected again is a no-op).

**Buttons.**
- **Primary action**: violet fill, `background:#8b5cf6; border:1px solid
  #8b5cf6; color:#fff; font-weight:600`. Hover `#7c4ddb`.
- **Default**: inherits the generic dark style (`#27272a` background).
- **Toggle-on state**: violet fill (same as primary).
- **Star/icon buttons in a row** (e.g. `sandbox/rate/nodes/RateGames.ts`): small, low padding (`padding:2px 5px`), tight tracking (`letter-spacing:-2px` when icons are stars).

**Inputs in tight rows.** When you have an input + a button on one row, wrap them in a flex container; size the input with `flex:1; min-width:0` and the button with `flex:none`.

**Don't restate the pull model in the UI.** "Run to here" is already on the node toolbar; the canvas already turns amber when stale. A terse unsynced count (`✎ 3 rated since the last pull`) is fine; a "commit" button or a "click to refresh" CTA is not — that's a different mental model than the rest of Cocoon.

## 9 — Common gotchas

- **`process` doesn't see free-form control state.** The opaque control blob is for drafts only; the durable file is the truth. If a knob should change the output, declare it as a steering control.
- **A control event NEVER re-runs `process`.** The shim never round-trips through the graph. The control stays live because `data()` re-derives.
- **`markStale()` is NOT a re-run.** It just ages the node + downstream. The user (or agent) pulls when ready.
- **Don't draw a hook from `render`.** `render` is sync and pure (no I/O, no DOM). Emit a `<div data-cocoon-hook="…">` placeholder; the hook owns the canvas.
- **A node that breaks at import time fails only itself.** The resolver catches load errors per module. Check `query overview` → `loadErrors` first when a node "won't run".
- **Watch the symmetric-import rule.** If you co-locate a `hook` export AND a top-level `import {something} from 'node:fs'`, the bundler tries to ship `node:fs` to the browser and the bundle fails. Use dynamic `import('node:fs')` inside `process` instead — see `examples/bgg/nodes/Shortlist.ts` for the `const nodeImport = (s: string) => import(s)` helper.
- **Multi-edge inputs come pre-flattened.** Don't call `.flat()` on them again.

## 10 — A minimal scaffold

```ts
// nodes/MyNode.ts
import { z } from 'zod';
import type { CocoonProcessNode } from '<path-to-prototype>/core/contract.ts';

const Row = z.object({ id: z.string() /* … */ });
type Row = z.infer<typeof Row>;

const Inputs = z.object({ data: z.array(Row).optional() });
const Knobs = z.object({ topN: z.number().int().min(1).max(100) });

interface ViewData {
  ready: boolean;
  rows: Row[];
  total: number;
}

const MAX_ROWS = 30;

export const MyNode: CocoonProcessNode = {
  category: 'MyDomain',
  description: 'One-line description shown in the inspector.',

  controls: {
    topN: { kind: 'number', label: 'top N', default: 10, min: 1, max: 100 },
  },

  async *process(ctx) {
    const { data } = ctx.ports.read(Inputs);
    const { topN } = ctx.controls.read(Knobs);
    const rows = (data ?? []).slice(0, topN);
    ctx.ports.write({ data: rows, total: data?.length ?? 0 });
    return `${rows.length} kept`;
  },

  control: {
    window: { width: 560, height: 480 },

    data(ctx): ViewData {
      const rows = (ctx.output.data as Row[] | undefined) ?? [];
      const total = (ctx.output.total as number | undefined) ?? 0;
      return { ready: rows.length > 0, rows: rows.slice(0, MAX_ROWS), total };
    },

    render(ctx) {
      const d = (ctx.data as ViewData) ?? { ready: false, rows: [], total: 0 };
      if (ctx.surface === 'node') {
        return `${STYLE}<div class="mynode-compact">
  <strong>MyNode</strong>
  <p>${d.total} rows</p>
  <button data-cocoon-event="$open">Open ▸</button>
</div>`;
      }
      if (!d.ready) return `${STYLE}<div class="mynode"><p class="empty">pull upstream to load</p></div>`;
      const list = d.rows.map(r => `<li>${esc(r.id)}</li>`).join('');
      return `${STYLE}<div class="mynode">
  <header class="head"><h1>MyNode</h1><p class="sub">${d.total} rows</p></header>
  <section class="card"><ul class="entries">${list}</ul></section>
</div>`;
    },
  },
};

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `<style>
.control .mynode-compact { display:flex; flex-direction:column; gap:6px; }
.control .mynode-compact strong { font-size:12px; color:#fb923c; }
.control .mynode-compact p { margin:0; color:#9a9aa6; font-size:11px; }
.control .mynode-compact button { background:#8b5cf6; border:1px solid #8b5cf6; color:#fff; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; }
.control .mynode-compact button:hover { background:#7c4ddb; border-color:#7c4ddb; }

.control .mynode {
  --card:#212128; --line:#303039; --muted:#9a9aa6;
  display:flex; flex-direction:column; gap:14px; color:#e7e7ea; font-size:11.5px;
}
.control .mynode .head h1 { margin:0; font-size:15px; color:#fb923c; }
.control .mynode .head .sub { margin:3px 0 0 0; color:var(--muted); font-size:11px; }
.control .mynode .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.control .mynode .entries { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px; }
.control .mynode .empty { color:var(--muted); font-style:italic; padding:20px; text-align:center; margin:0; }
</style>`;
```
