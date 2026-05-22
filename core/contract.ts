/**
 * Node-author contract. A node is a plain Node.js module exporting a
 * `process` async generator that reads input ports, writes output ports,
 * yields progress, and returns a one-line summary string. Optional
 * `control.{data,render,event}` for a free-form control surface, and a
 * browser `hook` export for its render code (see `ControlHook`).
 *
 * Type-only imports from the shared wire protocol keep the contract single-
 * sourced with the editor; nothing is bundled.
 */
import type { ControlHook, ControlSchema } from '../src/lib/protocol.ts';
export type { ControlHook, ControlSchema };

/** Progress: a message, a 0..1 fraction, both, or nothing. */
export type Progress = string | number | [string, number] | void;

export interface ProcessContext {
  /** Resolved inputs: literal `in:` params merged with upstream port data. */
  ports: {
    read(): Record<string, unknown>;
    write(data: Record<string, unknown>): void;
  };
  /**
   * Effective values of this node's declared steering controls — the runtime
   * overlay (set via `setControl`) merged over the schema defaults. `{}` when
   * the node declares no `controls`. A change ages the node `stale`; the
   * user re-pulls to apply.
   */
  controls: {
    read(): Record<string, unknown>;
  };
  debug(...args: unknown[]): void;
  /** Absolute path of the cocoon.yml. Prefer `resolvePath()` for files. */
  cocoonFilePath: string;
  /**
   * Resolve a path against the flow directory. `path.resolve` semantics
   * (absolute segments win); a leading `~` in the first segment expands to
   * `$HOME`. No args ⇒ the flow dir itself (e.g. a subprocess `cwd`). The
   * core does not `chdir` to the flow dir, so this is the only correct
   * primitive for fs-touching nodes.
   */
  resolvePath(...segments: string[]): string;
  /**
   * Run another node *type* as a temporary sub-node mid-`process()`, with
   * explicit inputs, capturing its outputs. The sub-node sees `ports.read()
   * → inputs` and `ports.write(d) → Object.assign(outputs, d)`; everything
   * else (`resolvePath`, `nodeId`, nested `processTemporaryNode`) is
   * inherited. `controls` is empty (no graph identity → no overlay).
   * `opts.debug` overrides the inherited debug fn. Throws on an
   * unknown/failed-to-load type or a self-composite.
   */
  processTemporaryNode(
    nodeType: string,
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
    opts?: { debug?: (...args: unknown[]) => void }
  ): AsyncGenerator<Progress, void, void>;
  nodeId: string;
}

export interface CocoonProcessNode {
  category?: string;
  description?: string;
  /**
   * Code-declared steering controls. Effective values reach `process()` via
   * `ctx.controls.read()`. Steering only — setting one ages the node
   * `stale`, no side effects. Model a side-effecting knob as a downstream
   * node where possible.
   */
  controls?: Record<string, ControlSchema>;
  /**
   * Free-form, server-rendered control (LiveView model). The core calls
   * `render` to get inert HTML and streams it; a generic browser shim posts
   * `data-cocoon-event` events back to `event`. Node JS never runs in the
   * browser — only the bundled `hook` does. There is deliberately no
   * declared schema: agents read the module's source to drive it.
   */
  control?: ControlRender;
  process(context: ProcessContext): AsyncGenerator<Progress, string | void, void>;
}

/**
 * Context a control's `data`/`render`/`event` receives. `control` is an
 * opaque blob for UNSAVED INPUT DRAFTS ONLY (e.g. an editor's textarea
 * before Save). Never cache derived state here — re-derive from durable
 * truth in `data()` every cycle.
 */
export interface ControlContext {
  ports: { read(): Record<string, unknown> };
  /**
   * The node's own output ports — what `process()` last wrote; `{}` before
   * first pull. Frozen between pulls (the pull-graph snapshot, not a cache),
   * so `data()` sees a batch frozen at pull time; the durable file stays
   * live.
   */
  output: Record<string, unknown>;
  control: {
    read(): Record<string, unknown>;
    set(patch: Record<string, unknown>): void;
  };
  /** The event payload (form fields); `{}` for `data`/`render`/`$mount`. */
  payload: unknown;
  /** The payload `data()` produced this cycle. `undefined` inside `data()`
   *  itself and when no `data` half is declared. */
  data: unknown;
  /**
   * `'node'` (compact inline surface) or `'window'` (detached full-size).
   * Always `'node'` for `data`/`event`/`$mount` — no surface is acting.
   */
  surface: 'node' | 'window';
  /**
   * Signal the node's output is now outdated (the handler changed its
   * durable file). Ages the node + downstream `stale`. Not a rerun — the
   * user pulls when they want it folded downstream.
   */
  markStale(): void;
  debug(...args: unknown[]): void;
  /** Raw escape hatch; prefer `resolvePath()`. */
  cocoonFilePath: string;
  /** Flow-relative path resolution — see `ProcessContext.resolvePath`. */
  resolvePath(...segments: string[]): string;
  nodeId: string;
}

export interface ControlRender {
  /** Initial detached-window size in CSS px. User resize wins for the
   *  window's lifetime. Omit ⇒ editor default. */
  window?: { width: number; height: number };
  /**
   * Pure data half. Compute a bounded payload from resolved inputs + the
   * node's own durable file. May be async. Recomputed after `process` AND
   * every control event — presentation only, never a pull. Streams as
   * `controlData` → fed to the render `hook` as `props.data`.
   */
  data?(ctx: ControlContext): unknown | Promise<unknown>;
  /**
   * Inert HTML from `ctx.data` + `ctx.surface`. Pure, sync — no I/O.
   * May carry `data-cocoon-hook` elements the co-located `hook` renders
   * into and `data-cocoon-event` attrs the generic shim translates to
   * events.
   */
  render(ctx: ControlContext): string;
  /**
   * Handle a browser/agent event. Changes the durable truth (writes the
   * node's file), may hold an unsaved draft via `ctx.control.set`, may
   * `ctx.markStale()`. No rerun — the control re-derives via `data()`
   * every event. The reserved `'$mount'` event is handled by the core and
   * never reaches this handler.
   */
  event?(
    ctx: ControlContext,
    ev: { event: string; payload: unknown }
  ): void | Promise<void>;
}

export type Registry = Record<string, CocoonProcessNode>;
