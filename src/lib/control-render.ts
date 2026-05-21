/**
 * The control **browser render hook** contract (keystone 2/5) — the LiveView
 * `phx-hook` analogue, and the *only* render contract in Cocoon.
 *
 * A node is one co-located source file: `process` + `control.{data,render,
 * event}` (Node side, loaded by the keystone-6 resolver) **and**
 * `export const hook` (this contract — the browser render half). The core
 * never evaluates the hook (the symmetric dynamic-import rule keeps its
 * browser-only deps out of the Node side); the delivery seam esbuild-bundles
 * just the `hook` export, served `GET /hook/<type>?m=<mtime>`, resolved by
 * convention from the node — no registry.
 *
 * It is deliberately framework-agnostic and depends on *nothing*: a hook can
 * be ECharts, D3, canvas, plain DOM, or a CDN-pinned lib it dynamic-imports
 * inside `mount`. The host (Svelte Flow, here) only ever calls
 * mount/update/destroy via the generic `controlAction` shim. `props.data` is
 * the core-computed `controlData` (`control.data` — the bounded payload, the
 * same slice the agent reads); it changes data-only (no HTML churn), so a
 * hook updates in place rather than being torn down.
 *
 * This is the surviving half of the old framework-agnostic "View" split:
 * the pure data side moved into `control.data` (core), the imperative render
 * side is this. There is no separate View concept — a visualisation is a
 * control with a hook and no `event`; a selectable one adds `event`.
 */

export interface ControlHookProps<Data = unknown> {
  /** The node's streamed `controlData` (the `control.data` payload). */
  data: Data;
}

export interface ControlHookInstance<Data = unknown> {
  update(props: ControlHookProps<Data>): void;
  destroy(): void;
}

export interface ControlHook<Data = unknown> {
  mount(
    el: HTMLElement,
    props: ControlHookProps<Data>
  ): ControlHookInstance<Data>;
}
