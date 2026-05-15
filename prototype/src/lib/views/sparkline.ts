import type { CocoonView } from '../view-contract';

/**
 * Demo View with ZERO UI-framework dependencies — proves the thesis from the
 * React-vs-Svelte discussion. Legacy `@cocoon/plugin-echarts` Echarts.tsx was
 * ~60 lines of componentDidMount/Update/Unmount glue around imperative
 * `echarts.init()/setOption()/dispose()`. That maps 1:1 onto this
 * mount/update/destroy shape, which a Svelte action drives just as trivially
 * as a React effect would. Here we hand-draw to a <canvas> to make the point
 * that no charting library — and no React — is required by the contract.
 */

export interface SparkData {
  values: number[];
}

export interface SparkState {
  /** Index the user hovered; pushed back out via brushing & linking. */
  highlight: number | null;
}

export const Sparkline: CocoonView<SparkData, SparkState> = {
  serialiseViewData(data, _state) {
    const values = data
      .map(d => (typeof d === 'number' ? d : (d as { value?: number })?.value))
      .filter((v): v is number => typeof v === 'number');
    return values.length ? { values } : null;
  },

  respondToQuery(data, query) {
    return data[query as number];
  },

  mount(el, props) {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '60px';
    canvas.style.display = 'block';
    el.appendChild(canvas);

    let current = props;

    const draw = () => {
      const { values } = current.data;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth || 220;
      const h = 60;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
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
      values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();

      const hi = current.viewState.highlight;
      if (hi != null && values[hi] != null) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(x(hi), y(values[hi]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // Interaction -> brushing & linking, exactly as a real Cocoon view would.
    const onMove = (e: MouseEvent) => {
      const n = current.data.values.length;
      if (!n) return;
      const rect = canvas.getBoundingClientRect();
      const idx = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1));
      current.setViewState({ highlight: Math.max(0, Math.min(n - 1, idx)) });
    };
    canvas.addEventListener('mousemove', onMove);

    draw();

    return {
      update(next) {
        current = next;
        draw();
      },
      destroy() {
        canvas.removeEventListener('mousemove', onMove);
        canvas.remove();
      },
    };
  },
};
