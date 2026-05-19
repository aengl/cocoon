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

/**
 * Capabilities the *core* injects into `serialiseViewData` (it runs core-side,
 * so it may touch the filesystem; the browser never calls it). Mirrors the
 * `context` legacy `CocoonView.serialiseViewData(context, …)` received — kept
 * minimal and capability-shaped so a View still depends on *nothing* (no
 * `node:fs` import that would poison the browser bundle).
 */
export interface ViewSerialiseContext {
  /**
   * Read a file (relative paths resolve against the cocoon file's directory,
   * like the I/O nodes) and return it base64-encoded with a guessed MIME, or
   * `null` if it can't be read. The only door a View has to the filesystem.
   */
  readFileBase64(filePath: string): { base64: string; mime: string } | null;
}

/** Pure, server-side-friendly half. Identical in spirit to legacy CocoonView. */
export interface ViewDataLogic<Data, ViewState, Query = unknown, QueryResponse = unknown> {
  /**
   * The port this view binds to when its view string is type-only (e.g. bare
   * `view: Image` instead of `out/src/Image`). Legacy `CocoonView.defaultPort`.
   * Omitted ⇒ the core defaults to the outgoing `data` port.
   */
  defaultPort?: { incoming: boolean; name: string };
  /** Reduce raw node data + view state into the minimal payload the view renders. */
  serialiseViewData(
    data: unknown[],
    state: ViewState,
    context?: ViewSerialiseContext
  ): Data | null;
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

/**
 * A control's **browser render hook** — the LiveView `phx-hook` analogue
 * (keystone 2/5). Deliberately *the same shape as `ViewRenderer`*: a control
 * with a hook and no `event` IS a View; one render contract, not a third.
 *
 * It lives in the **same source file as the node** (`export const hook`),
 * co-located with `process`/`control.{data,render}`. The core never
 * evaluates it (the symmetric dynamic-import rule keeps its browser deps —
 * `wordcloud`, `window` — out of the Node side); the delivery seam
 * esbuild-bundles just this export for the browser, resolved by convention
 * from the node (no registry). `props.data` is the streamed `controlData`.
 */
export type ControlHookInstance<Data = unknown> = ViewInstance<Data, unknown>;
export type ControlHook<Data = unknown> = ViewRenderer<Data, unknown>;
