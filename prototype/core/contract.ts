/**
 * The node-author contract. A faithful trim of legacy `@cocoon/types`
 * `CocoonNode` / `CocoonNodeContext`: a node is a plain Node.js module
 * exporting a `process` async generator that reads input ports, writes output
 * ports, yields progress, and *returns* a one-line summary string.
 *
 * Kept registry-free and UI-free on purpose — its only import is the
 * *type* of `ControlSchema` from the shared wire protocol (erased by Node's
 * strip-types; nothing is bundled), so the code-declared control vocabulary
 * has a single definition shared with the editor instead of drifting copies.
 */
import type { ControlSchema } from '../src/lib/protocol.ts';
export type { ControlSchema };
// The browser render-hook contract (keystone 2/5). Type-only (erased by
// Node's strip-types — nothing bundled), so a co-located node module can
// `import type { ControlHook }` next to `CocoonProcessNode` and export its
// `hook` from the same file.
import type { ControlHook } from '../src/lib/control-render';
export type { ControlHook };

/** Legacy `Progress`: a message, a 0..1 fraction, both, or nothing. */
export type Progress = string | number | [string, number] | void;

export interface ProcessContext {
  /** Resolved inputs: literal `in:` params merged with upstream port data. */
  ports: {
    read(): Record<string, unknown>;
    write(data: Record<string, unknown>): void;
  };
  /**
   * Effective values of this node's code-declared steering controls
   * (keystone 5): the runtime overlay set via `setControl` merged over the
   * schema defaults. Read exactly like ports — the value steers what
   * `process()` puts on the output, so a change is just `stale` → re-pull.
   * `{}` when the node declares no `controls`.
   */
  controls: {
    read(): Record<string, unknown>;
  };
  debug(...args: unknown[]): void;
  /**
   * Absolute path of the cocoon.yml. Prefer `resolvePath()` for files — this
   * is the raw escape hatch (rarely needed directly).
   */
  cocoonFilePath: string;
  /**
   * Resolve a path against the flow directory (where `cocoonFilePath` lives).
   * `path.resolve` semantics — absolute segments win; a leading `~` in the
   * first segment expands to `$HOME`. No args ⇒ the flow dir itself (e.g. a
   * subprocess `cwd`).
   *
   * The single primitive every fs-touching node needs. Legacy
   * `process.chdir`'d to the flow dir at parse time; the prototype core
   * deliberately does not (global mutable state breaks headless multi-run /
   * the file-watcher / concurrent flows), so nodes resolve **explicitly**
   * through this rather than re-deriving
   * `path.resolve(path.dirname(cocoonFilePath), …)` (which scattered into ~8
   * copies and a per-tibi-node cast tax — the smell this removes). The
   * eventual function-library / dependency-inversion model (`ctx` opaque,
   * threaded only through vocabulary fns) will *wrap* this, not replace it —
   * it is the substrate that model stands on. See CLAUDE.md keystone 6.
   */
  resolvePath(...segments: string[]): string;
  /**
   * Run another node *type* as a temporary, in-process sub-node mid-
   * `process()`, with explicit inputs, capturing its outputs. Faithful port
   * of legacy `@cocoon/util/processTemporaryNode` (a 20-line async generator:
   * self-composite guard → resolve the type → run it on a context whose
   * `ports` are overridden, forwarding progress). Legacy resolved the type
   * from `context.registry`; the prototype is registry-free, so resolution
   * lives on the runtime — hence this is a `ProcessContext` capability backed
   * by the core (the `resolvePath`→`resolveFlowPath` pattern), not a free
   * function a node could import.
   *
   * The sub-node sees a temp context: `ports.read()` → `inputs`,
   * `ports.write(d)` → `Object.assign(outputs, d)` (so the caller reads
   * results off the object it passed); everything else (`resolvePath`,
   * `nodeId`, nested `processTemporaryNode`, …) is inherited. `controls` is
   * empty — a programmatically-driven sub-node has no graph identity / no
   * steering overlay; it reads its config from `inputs` (legacy had no
   * controls concept here at all). `opts.debug` replaces the inherited
   * `debug` — the *only* context field legacy callers ever overrode
   * (`PublishCollections` silences `Score`, which it runs once per
   * collection). Yields the sub-node's progress; throws on an
   * unknown/failed-to-load type or a self-composite (`nodeType` ===
   * the calling node's own type).
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
  /** Default to caching this node's output to disk (overridable per-node). */
  persist?: boolean;
  /**
   * Code-declared steering controls (keystone 5) — the one narrow,
   * deliberate registry-free exception (ports stay YAML-structure-derived).
   * The schema is streamed to the editor like a view payload; effective
   * values reach `process()` via `ctx.controls.read()`. Steering only:
   * setting one marks the node `stale` (set → re-pull), zero side-effects by
   * construction. Side-effecting/action controls (`invokeControl`) come
   * later — model a side-effect as a downstream node where possible.
   */
  controls?: Record<string, ControlSchema>;
  /**
   * A free-form, server-rendered control (keystone 5 action tier — the
   * Phoenix-LiveView model). The node *is* the control: same module, one
   * close contract. The core calls `render` to get inert HTML and streams
   * it; a generic browser shim posts `data-cocoon-event` events back, which
   * `event` interprets. **No node code ever runs in the browser** — only the
   * rendered HTML crosses the wire (HTML is data, not code), so the
   * registry-free / browser-is-a-pure-viewer keystone still holds. There is
   * deliberately *no* declared schema: the shape is the node's business
   * ("anything from a form to a Captcha"); the agent reads this module's
   * source to learn how to drive it (keystone 6 — code is the documentation).
   */
  control?: ControlRender;
  process(context: ProcessContext): AsyncGenerator<Progress, string | void, void>;
}

/**
 * The context a control's `data`/`render`/`event` receives. `ports.read()`
 * is the node's resolved inputs (same as `process`). `control` is an
 * *opaque, ephemeral* blob for **unsaved input drafts only** (e.g. an
 * editor's textarea before Save) — never for *derived* state (a cursor /
 * batch membership); that must be re-derived from the durable truth in
 * `data()`, never cached (every cached-derived-state bug in this model came
 * from caching it). Durable data is ordinary node I/O (the annotation
 * *file*); the control is only the trigger.
 */
export interface ControlContext {
  ports: { read(): Record<string, unknown> };
  /**
   * The node's own processed **output** ports (what `process()` last wrote;
   * `{}` before first pull). Frozen between pulls — the pull-graph snapshot,
   * not a cache — so a `data()` that reads it gets a *batch frozen at pull
   * time* (re-run the node ⇒ next batch), while reading the durable file
   * stays live. The pure data half derives from the node's output (a
   * visualisation node reads it here, e.g. `core/nodes/Scatterplot.ts`).
   */
  output: Record<string, unknown>;
  control: {
    read(): Record<string, unknown>;
    set(patch: Record<string, unknown>): void;
  };
  /** The event payload (form fields); `{}` for `data`/`render`/`$mount`. */
  payload: unknown;
  /**
   * The payload `data()` produced for this cycle — what `render` draws and
   * what streams to the agent as `controlData`. `undefined` in `data()`
   * itself and when no `data` half is declared.
   */
  data: unknown;
  /**
   * Where this render is headed: `'node'` = the compact inline surface on
   * the node box (tight size budget — show a summary + an open button);
   * `'window'` = the detached, full-size `ControlWindow`. One `render`, two
   * surfaces, the node's call (a compact node preview vs the roomy window).
   * Always `'node'` for `data`/`event`/`$mount` (no surface is acting).
   */
  surface: 'node' | 'window';
  /**
   * Signal the node's output is now outdated (the handler changed its
   * durable file): age this node + downstream `stale`. An **honest pull
   * signal**, not a rerun — the user pulls when they want it folded
   * downstream; the control itself stays live by re-deriving its own
   * bounded payload (`data()`), which is presentation, not graph execution.
   */
  markStale(): void;
  debug(...args: unknown[]): void;
  /** Raw escape hatch; prefer `resolvePath()`. See `ProcessContext`. */
  cocoonFilePath: string;
  /** Flow-relative path resolution — see `ProcessContext.resolvePath`. */
  resolvePath(...segments: string[]): string;
  nodeId: string;
}

export interface ControlRender {
  /**
   * Core-side **pure data half**. Compute a *bounded* payload (a batch of
   * items to review, progress, the points of a scatterplot, …) from resolved
   * inputs + the node's own durable file. Async (it may read the file).
   * Recomputed after `process` AND every control event — this is
   * presentation (pure, bounded, no graph execution), never a pull, so it
   * keeps the control live without re-running the node. Streams as
   * `controlData` → fed to the render `hook` as `props.data`, and the agent
   * reads the same bounded slice the human sees. Omit ⇒ no payload (a pure
   * draft form like Annotate's needs none).
   */
  data?(ctx: ControlContext): unknown | Promise<unknown>;
  /** Inert HTML from `ctx.data` (+ `ctx.surface`). Pure, sync — no I/O
   *  (that's `data`'s job). May carry `data-cocoon-hook` elements the
   *  co-located `export const hook` renders into; interactivity is a generic
   *  Cocoon shim + `data-cocoon-event` attrs, never node JS in the browser
   *  (only the bundled `hook` runs there). */
  render(ctx: ControlContext): string;
  /**
   * Handle a browser/agent event (form submit / tagged button). Changes the
   * *durable truth* (writes the node's file), may hold an unsaved draft via
   * `ctx.control.set`, and may `ctx.markStale()`. **No rerun**: the control
   * re-derives via `data()` after every event. The reserved `'$mount'`
   * event is handled by the core (skips this handler) — it just re-derives
   * + streams so a surface shows its live payload as soon as it appears.
   */
  event?(
    ctx: ControlContext,
    ev: { event: string; payload: unknown }
  ): void | Promise<void>;
}

export type Registry = Record<string, CocoonProcessNode>;
