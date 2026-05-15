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

  return {
    update(next: ViewActionParams) {
      p = next;
      instance.update(props());
    },
    destroy() {
      instance.destroy();
    },
  };
};
