import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * The keystone 2/5 demo node — a tag cloud rendered by a **real canvas JS
 * library** inside a control, the case the View→control decision was forced
 * by. Structurally identical to `sandbox/rate`'s `RatingHistogram`:
 *
 *  - `process()` is a pure transform: turn `{tag,count}` rows into weighted
 *    tags and emit them as an ordinary output port (so it's normal
 *    data-flow; the control reads it back via `ctx.output`, the
 *    `serialiseViewData`/frozen-pull-output model).
 *  - `control.data()` is the core-side data half: derive a *bounded*
 *    `{tags:[{tag,weight}]}` from the frozen output. Pure, no I/O, no cache.
 *  - `control.render()` returns a `data-cocoon-hook="TagCloud"` element —
 *    author render JS delivered via the ONE disciplined path (keystone 2/5,
 *    the LiveView `phx-hook` analogue; the browser hook is
 *    `src/lib/controlHooks.ts`, reusing the `ViewRenderer` contract verbatim
 *    so the two render paths converge rather than fork).
 *  - There is deliberately **NO `event` handler**: a legacy View is exactly
 *    `data` + a render half. The sole difference from `RatingHistogram` is
 *    that the renderer is a library (`wordcloud`) instead of hand-rolled
 *    SVG — precisely what the dead inert-HTML rule forbade. (A click→select
 *    `event` is the natural next step: "a selection is just an event" —
 *    keystone 2/5 — out of scope for this first port.)
 */

type Row = Record<string, unknown>;
interface WTag {
  tag: string;
  weight: number;
}

/** Cap the streamed payload — it's the agent's `controlData` slice too, so a
 *  real bound, not just UI tidiness (same discipline as `RateGames`). */
const MAX_TAGS = 60;

/**
 * The node ships its own styling inside its rendered HTML (keystone 5/6 —
 * HTML is data, the node's source is the contract). `CocoonNode` provides
 * only generic dark-theme defaults; the cloud chrome is the node's, scoped
 * under `.tagcloud*` so co-resident control windows can't collide. The hook
 * container must have a definite size — the detached window gives it height;
 * `min-height` keeps it sane if mounted somewhere cramped.
 */
const STYLE = `<style>
.control .tagcloud,
.control .tagcloud-compact { display:flex; flex-direction:column; gap:6px; }
.control .tagcloud { height:100%; min-height:240px; }
.control .tagcloud .cloud { flex:1; min-height:220px; }
.control .tagcloud-compact .cloud-mini { width:100%; height:140px; }
.control .tagcloud-foot { font-size:9.5px; color:#71717a; }
</style>`;

export const MakeTagCloud: CocoonProcessNode = {
  category: 'Visualisation',
  description: 'Weighted tag cloud rendered by a control hook (wordcloud).',

  // Pure transform: weight = 1 + log2(count) (gentle log scale so the cloud
  // has size variety without a giant outlier swamping it). Emits `cloud` as
  // a real port — ordinary data-flow; the control reads it via ctx.output.
  async *process(ctx) {
    const { data } = ctx.ports.read() as { data?: Row[] };
    const rows = Array.isArray(data) ? data : [];
    const cloud: WTag[] = rows
      .map(r => {
        const tag = String(r.tag ?? '').trim();
        const count = Number(r.count ?? 0);
        if (!tag || !Number.isFinite(count) || count <= 0) return undefined;
        return { tag, weight: Math.round((1 + Math.log2(count)) * 10) / 10 };
      })
      .filter((t): t is WTag => t !== undefined)
      .sort((a, b) => b.weight - a.weight);
    ctx.ports.write({ data: rows, cloud });
    return `${cloud.length} tags`;
  },

  control: {
    // Data half — the `serialiseViewData` twin. Reads the frozen pull output
    // (the keystone-5 frozen-batch read), bounds it, hands it to render.
    // Streams as `controlData` → the browser hook draws exactly this, and
    // the agent reads the same bounded slice the human sees.
    data(ctx): { ready: boolean; tags: WTag[] } {
      const cloud = ctx.output.cloud as WTag[] | undefined;
      if (!Array.isArray(cloud) || cloud.length === 0)
        return { ready: false, tags: [] };
      return { ready: true, tags: cloud.slice(0, MAX_TAGS) };
    },

    render(ctx) {
      const d = (ctx.data as { ready: boolean; tags: WTag[] }) ?? {
        ready: false,
        tags: [],
      };
      const compact = ctx.surface === 'node';

      if (!d.ready) {
        const msg = 'run the node to build the cloud';
        return compact
          ? `${STYLE}<div class="tagcloud-compact"><strong>Tag cloud</strong><p>${msg}</p>
  <button data-cocoon-event="$open">Open cloud ▸</button></div>`
          : `${STYLE}<div class="tagcloud"><p>${msg}</p></div>`;
      }

      // Compact node surface: the SAME hook, just a smaller box. The hook
      // scales to its container (keystone "adjust to all sizes"), so the
      // inline cloud and the windowed one are one renderer at two sizes —
      // the open button still pops the roomier window.
      if (compact)
        return `${STYLE}<div class="tagcloud-compact">
  <div class="cloud-mini" data-cocoon-hook="TagCloud"></div>
  <button data-cocoon-event="$open">Open cloud ▸</button>
</div>`;

      // Window surface: the hook container. The HTML is static (only the
      // streamed `controlData` changes) → controlAction keeps the canvas and
      // calls the hook's `update()` in place, never a re-mount.
      return `${STYLE}<div class="tagcloud">
  <div class="cloud" data-cocoon-hook="TagCloud"></div>
  <p class="tagcloud-foot">drawn by the <code>wordcloud</code> canvas lib via the control render hook (keystone 2/5) — no separate View, no rewrite cliff</p>
</div>`;
    },
  },
};

/**
 * The browser render hook — the **same source module as the node**
 * (keystone 2/5, true single-file co-location). The core never evaluates
 * this: `wordcloud` is **dynamically imported inside `mount`** (the
 * symmetric-import rule), so when the keystone-6 resolver loads this file in
 * Node for `process`/`control`, the canvas lib + `window` are never touched.
 * The delivery seam esbuild-bundles *only* this export for the browser;
 * `props.data` is the streamed `controlData` (`control.data` above). Reuses
 * the `ViewRenderer` contract verbatim — a render-only control IS a View,
 * one render path.
 */
export const hook: ControlHook<{ ready?: boolean; tags?: WTag[] }> = {
  mount(el, props) {
    const root = document.createElement('div');
    // `height:100%` fills a host that resolves a height (the node box, the
    // window `.mount`); `min-height` is the **defensive floor** so a render
    // hook is NEVER a zero-height (invisible) box if some host's CSS doesn't
    // establish a definite height. ≤ the compact surface's 140px so it
    // doesn't overflow the inline node.
    root.style.cssText =
      'position:relative;width:100%;height:100%;min-height:120px;overflow:hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block';
    root.appendChild(canvas);
    el.appendChild(root);

    let tags = props.data?.tags ?? [];
    let WC:
      | (((c: HTMLElement, o: Record<string, unknown>) => void) & {
          isSupported: boolean;
        })
      | undefined;

    const draw = () => {
      const w = root.clientWidth || 320;
      const h = root.clientHeight || 200;
      canvas.width = w * 2; // retina-crisp (canvas 2× the CSS box)
      canvas.height = h * 2;
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      const list = tags
        .filter(t => t && t.tag && t.weight > 0)
        .map(t => [t.tag, t.weight] as [string, number]);
      if (!WC || !WC.isSupported || list.length === 0) return;
      // Scale to the *container* (the "adjust to all sizes" requirement):
      // heaviest word ≈ 38% of the short edge, gridSize tracks the box, so
      // one renderer fits the tiny inline strip and a large window.
      const shortEdge = Math.min(canvas.width, canvas.height);
      const maxW = Math.max(1, ...list.map(([, wt]) => wt));
      WC(canvas, {
        list,
        weightFactor: Math.max(2, (shortEdge * 0.38) / maxW),
        gridSize: Math.max(2, Math.round(shortEdge / 64)),
        fontFamily: 'Merienda, system-ui, sans-serif',
        color: () => `hsl(${Math.floor(Math.random() * 50) + 20},70%,55%)`,
        backgroundColor: 'transparent',
      });
    };

    // Dependency declared **in the node's own source as a pinned CDN URL**
    // (keystone 6 — the node carries its own everything; nothing to install,
    // no node_modules). Dynamic + not module-top, so the Node side never
    // reaches it; the delivery seam's esbuild HTTP loader fetches & inlines
    // it at *bundle* time, so the served hook stays one self-contained file.
    import('https://esm.sh/wordcloud@1.2.2?bundle')
      .then(m => {
        WC = (m as { default: typeof WC }).default;
        draw();
      })
      .catch(() => {
        /* no cloud lib ⇒ the node still shows its HTML, just no canvas */
      });

    // The hook self-sizes (controlAction is generic, no resize feedback).
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    });
    ro.observe(root);
    draw();

    return {
      update(next) {
        tags = (next.data as { tags?: WTag[] } | undefined)?.tags ?? [];
        draw();
      },
      destroy() {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        // NB: no global WordCloud.stop() — the inline + window clouds
        // coexist; a global stop would abort the other's draw.
        root.remove();
      },
    };
  },
};
