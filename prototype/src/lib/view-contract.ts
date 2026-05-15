/**
 * Framework-agnostic View contract.
 *
 * This is the key architectural bet from the React-vs-Svelte decision:
 * legacy Cocoon's `CocoonView` (@cocoon/types) was split into a *data side*
 * (`serialiseViewData` / `respondToQuery`) that already has zero UI-framework
 * coupling, and a *render side* that was a React component
 * (`(props: CocoonViewProps) => JSX.Element`).
 *
 * The only genuinely React-bound thing in the whole contract was that single
 * `=> JSX.Element` typedef. Here it's replaced with a plain imperative
 * `mount(el, props) -> ViewInstance`. A View now depends on *nothing* — it can
 * be implemented with ECharts, D3, canvas, plain DOM, or wrapped from React or
 * Svelte. The host (Svelte Flow, in this prototype) only ever calls
 * mount/update/destroy.
 */

/** Pure, server-side-friendly half. Identical in spirit to legacy CocoonView. */
export interface ViewDataLogic<Data, ViewState, Query = unknown, QueryResponse = unknown> {
  /** Reduce raw node data + view state into the minimal payload the view renders. */
  serialiseViewData(data: unknown[], state: ViewState): Data | null;
  /** Optional: answer a query from the rendered view (e.g. tooltip lookup). */
  respondToQuery?(data: unknown[], query: Query): QueryResponse;
}

export interface ViewProps<Data, ViewState> {
  data: Data;
  viewState: ViewState;
  /**
   * Push view state back out (brushing & linking). In real Cocoon this travels
   * over the WebSocket/IPC layer to the processing instance and connected
   * views — independent of whichever UI framework draws the graph.
   */
  setViewState(next: Partial<ViewState>): void;
}

export interface ViewInstance<Data = unknown, ViewState = unknown> {
  update(props: ViewProps<Data, ViewState>): void;
  destroy(): void;
}

/** Render half: imperative, framework-agnostic. */
export interface ViewRenderer<Data, ViewState> {
  mount(el: HTMLElement, props: ViewProps<Data, ViewState>): ViewInstance<Data, ViewState>;
}

export type CocoonView<Data, ViewState, Query = unknown, QueryResponse = unknown> =
  ViewDataLogic<Data, ViewState, Query, QueryResponse> & ViewRenderer<Data, ViewState>;
