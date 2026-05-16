import type { Action } from 'svelte/action';
import type { ViewRenderer } from './view-contract';

interface ViewActionParams {
  /** Render half only. The pure `serialiseViewData` half ran in the core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: ViewRenderer<any, any>;
  /** Already-serialised payload streamed from the core (never bulk data). */
  data: unknown;
  viewState: Record<string, unknown>;
  onViewState: (next: Record<string, unknown>) => void;
}

/**
 * The entire React-vs-Svelte cost, in one place.
 *
 * Legacy `@cocoon/plugin-echarts/Echarts.tsx`:
 *   componentDidMount    -> action setup
 *   componentDidUpdate   -> update()
 *   componentWillUnmount -> destroy()
 *
 * A framework-agnostic View plugs into Svelte with this ~20-line action,
 * exactly as cheaply as it would plug into a React effect. No View needs to
 * know Svelte exists — and, because `serialiseViewData` runs in the core,
 * the browser only ever touches the render half (`mount/update/destroy`).
 */
export const view: Action<HTMLElement, ViewActionParams> = (el, params) => {
  let p = params!;

  const props = () => ({
    data: p.data,
    viewState: p.viewState,
    setViewState: (next: Record<string, unknown>) => p.onViewState(next),
  });

  const instance = p.renderer.mount(el, props());

  // Resize is a lifecycle event the imperative view can't see on its own:
  // the SVG views (`scatterplot`/`sparkline`) read `el.clientWidth` in their
  // draw and only redraw on `update()`. Inline node previews are fixed-size,
  // but a detached ViewWindow is resizable — so feed size changes back in as
  // an `update()`, exactly as the framework shim already feeds data changes.
  // rAF-debounced so a drag-resize coalesces to one redraw per frame; CSS
  // transforms (Svelte Flow pan/zoom) don't change the layout box, so this
  // stays quiet during canvas interaction.
  let w = el.clientWidth;
  let h = el.clientHeight;
  let raf = 0;
  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (el.clientWidth === w && el.clientHeight === h) return;
      w = el.clientWidth;
      h = el.clientHeight;
      instance.update(props());
    });
  });
  ro.observe(el);

  return {
    update(next: ViewActionParams) {
      p = next;
      instance.update(props());
    },
    destroy() {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      instance.destroy();
    },
  };
};
