import type { CocoonProcessNode, ControlHook } from '../contract.ts';

/**
 * Sparkline — a tiny line chart, the legacy `Sparkline` view as a
 * visualisation node (keystone 2/5). Zero dependencies (hand-drawn
 * `<canvas>` — no charting lib, the point of the original demo): pure
 * `serialiseViewData` half is `control.data`, imperative render half is
 * `export const hook`. No `event` — a visualisation is a render hook and
 * nothing else.
 *
 * Hover highlights the nearest sample. Legacy pushed that back out via
 * `setViewState` for brushing & linking; that is deferred (and will ride
 * the presence channel, not a view-state return path — CLAUDE.md), so the
 * highlight is purely local hook state here.
 */

interface SparkData {
  ready: boolean;
  values: number[];
}

const STYLE = `<style>
.control .spark,
.control .spark-compact { display:flex; flex-direction:column; gap:6px; }
.control .spark { height:100%; min-height:120px; }
.control .spark .line { flex:1; min-height:80px; }
.control .spark-compact .line-mini { width:100%; height:60px; }
.control .spark-foot { font-size:9.5px; color:#71717a; }
</style>`;

export const Sparkline: CocoonProcessNode = {
  category: 'Visualisation',
  description: 'Sparkline rendered by a zero-dep <canvas> control hook.',

  async *process(ctx) {
    const { data } = ctx.ports.read() as { data?: unknown[] };
    const rows = Array.isArray(data) ? data : [];
    ctx.ports.write({ data: rows });
    return `${rows.length} points`;
  },

  control: {
    data(ctx): SparkData {
      const out = ctx.output.data;
      const rows = Array.isArray(out) ? out : [];
      const values = rows
        .map(d =>
          typeof d === 'number' ? d : (d as { value?: number })?.value
        )
        .filter((v): v is number => typeof v === 'number');
      return values.length
        ? { ready: true, values }
        : { ready: false, values: [] };
    },

    render(ctx) {
      const d = ctx.data as SparkData | undefined;
      const compact = ctx.surface === 'node';
      if (!d?.ready) {
        const msg = 'run the node — needs a numeric series';
        return compact
          ? `${STYLE}<div class="spark-compact"><strong>Sparkline</strong><p>${msg}</p>
  <button data-cocoon-event="$open">Open ▸</button></div>`
          : `${STYLE}<div class="spark"><p>${msg}</p></div>`;
      }
      if (compact)
        return `${STYLE}<div class="spark-compact">
  <div class="line-mini" data-cocoon-hook="Sparkline"></div>
  <p>${d.values.length} points</p>
  <button data-cocoon-event="$open">Open ▸</button>
</div>`;
      return `${STYLE}<div class="spark">
  <div class="line" data-cocoon-hook="Sparkline"></div>
  <p class="spark-foot">${d.values.length} points · zero-dep canvas via the control render hook (keystone 2/5)</p>
</div>`;
    },
  },
};

/**
 * The browser render hook — same source module as the node (keystone 2/5).
 * Zero-dep `<canvas>`; the core never evaluates it. `props.data` is the
 * streamed `controlData`; self-sizes via its own `ResizeObserver`.
 */
export const hook: ControlHook<SparkData> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText =
      'position:relative;width:100%;height:100%;min-height:60px;overflow:hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block';
    root.appendChild(canvas);
    el.appendChild(root);

    let data = props.data;
    let highlight: number | null = null;

    const draw = () => {
      const values = data?.values ?? [];
      const dpr = window.devicePixelRatio || 1;
      const w = root.clientWidth || 220;
      const h = root.clientHeight || 60;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (values.length < 2) return;

      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const x = (i: number) => (i / (values.length - 1)) * w;
      const y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);

      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((v, i) =>
        i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))
      );
      ctx.stroke();

      if (highlight != null && values[highlight] != null) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(x(highlight), y(values[highlight]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // Local hover highlight (brushing & linking is deferred — no push-back).
    const onMove = (e: MouseEvent) => {
      const n = data?.values.length ?? 0;
      if (!n) return;
      const rect = canvas.getBoundingClientRect();
      const idx = Math.round(
        ((e.clientX - rect.left) / rect.width) * (n - 1)
      );
      highlight = Math.max(0, Math.min(n - 1, idx));
      draw();
    };
    const onLeave = () => {
      highlight = null;
      draw();
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

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
        data = next.data;
        draw();
      },
      destroy() {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        canvas.removeEventListener('mousemove', onMove);
        canvas.removeEventListener('mouseleave', onLeave);
        root.remove();
      },
    };
  },
};
