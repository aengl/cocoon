/**
 * Free-form controls (keystone 5, action tier): server-rendered HTML the
 * editor streams as `controlHtml`/`controlWindowHtml`, plus a `data` half
 * the agent reads bounded as `controlData`, plus an `event` handler that
 * writes durable truth and optionally `markStale`s.
 *
 * `statePatch` splits derive (compute `data` via `control.data`) from format
 * (build the inline/window HTML and the wire-side dedupe). No rerun — the
 * control stays live by re-deriving via `data()`.
 */
import type { ControlContext, ControlRender } from './contract.ts';
import type { NodeState } from '../src/lib/protocol.ts';

export interface RenderDeps {
  /** The node type currently declared in YAML (used to resolve its module). */
  typeOf(id: string): string | undefined;
  /** Mtime-aware resolve so a control-code edit is live on the next event. */
  resolve(
    type: string | undefined
  ): Promise<{ node?: { control?: ControlRender }; error?: string }>;
  /** Cache-only sync read; callers must have just `resolve`d. */
  peekControl(type: string | undefined): ControlRender | undefined;
  peekHookMtime(type: string | undefined): number | undefined;
  resolveInputs(id: string): Record<string, unknown>;
  nodeOutputs(id: string): Record<string, unknown>;
  hasNode(id: string): boolean;
  setState(id: string, patch: Partial<NodeState>): void;
  markStale(id: string): Promise<void>;
  downstream(id: string): string[];
  resolveFlowPath(...segments: string[]): string;
  cocoonFilePath: string;
}

export class RenderControls {
  /** Opaque per-node blob owned by the node's `control.{render,event}`. The
   *  core only holds and streams it; never inspected. Session-only. */
  private blobs = new Map<string, Record<string, unknown>>();
  private deps: RenderDeps;

  constructor(deps: RenderDeps) {
    this.deps = deps;
  }

  /** Drop opaque blobs for removed nodes. */
  forgetMissing(present: Set<string>): void {
    for (const id of [...this.blobs.keys()])
      if (!present.has(id)) this.blobs.delete(id);
  }

  private blobApi(id: string) {
    return {
      read: () => this.blobs.get(id) ?? {},
      set: (patch: Record<string, unknown>) =>
        this.blobs.set(id, { ...(this.blobs.get(id) ?? {}), ...patch }),
    };
  }

  private ctx(
    id: string,
    opts: {
      payload?: unknown;
      surface?: 'node' | 'window';
      data?: unknown;
      requestStale?: () => void;
    } = {}
  ): ControlContext {
    return {
      ports: { read: () => this.deps.resolveInputs(id) },
      output: this.deps.nodeOutputs(id),
      control: this.blobApi(id),
      payload: opts.payload ?? {},
      surface: opts.surface ?? 'node',
      data: opts.data,
      markStale: opts.requestStale ?? (() => {}),
      debug: (...a: unknown[]) => console.error(`[${id}]`, ...a),
      cocoonFilePath: this.deps.cocoonFilePath,
      resolvePath: (...s: string[]) => this.deps.resolveFlowPath(...s),
      nodeId: id,
    };
  }

  /** Compute `control.data`'s payload. Errors land in `data` as `{error}` so
   *  the format step still produces a renderable surface. */
  private async derive(
    id: string,
    ctl: ControlRender
  ): Promise<{ data: unknown; hookMtime: number | undefined }> {
    const hookMtime = this.deps.peekHookMtime(this.deps.typeOf(id));
    let data: unknown;
    try {
      data = ctl.data ? await ctl.data(this.ctx(id)) : undefined;
    } catch (err) {
      data = { error: err instanceof Error ? err.message : String(err) };
    }
    return { data, hookMtime };
  }

  /** Build the wire-format slice. Omits `controlWindowHtml` when render
   *  doesn't branch on surface (the common case — editor falls back to
   *  `controlHtml`). */
  private format(
    id: string,
    ctl: ControlRender,
    data: unknown,
    hookMtime: number | undefined
  ): Partial<NodeState> {
    const render = (surface: 'node' | 'window') => {
      try {
        return ctl.render(this.ctx(id, { surface, data }));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return `<pre class="control-error">control render failed: ${m}</pre>`;
      }
    };
    const inlineHtml = render('node');
    const windowHtml = render('window');
    return {
      controlHtml: inlineHtml,
      ...(windowHtml === inlineHtml ? {} : { controlWindowHtml: windowHtml }),
      controlData: data,
      controlHook:
        hookMtime === undefined ? undefined : { mtimeMs: hookMtime },
      controlWindow: ctl.window,
    };
  }

  /**
   * Re-derive the streamed control state. Presentation only; never re-runs
   * `process`. Called after a pull and after every control event.
   */
  async statePatch(id: string): Promise<Partial<NodeState>> {
    // `peek` (cache-only, sync) is correct because every caller — runOne and
    // event — has just `resolve`d the type, so modCache holds the freshest
    // module. Adding a `resolve()` here would perturb the foreground-vs-
    // hydrate race that other paths rely on.
    const ctl = this.deps.peekControl(this.deps.typeOf(id));
    if (!ctl?.render) return {};
    const { data, hookMtime } = await this.derive(id, ctl);
    return this.format(id, ctl, data, hookMtime);
  }

  /**
   * Handle one event. Handler throws are logged, never rethrown — the
   * *event* failed, the node is still done/stale. `$mount` skips the handler
   * (the shim fires it when a surface appears) and just re-derives + streams.
   * A handler may `ctx.markStale()` to signal its writes outdated the node's
   * output. No rerun: the control stays live by re-deriving via `data`.
   */
  async event(id: string, event: string, payload?: unknown): Promise<void> {
    if (!this.deps.hasNode(id)) return;
    const type = this.deps.typeOf(id);
    const r = await this.deps.resolve(type);
    if (r.error) console.error(`[${id}] control resolve: ${r.error}`);
    const ctl = r.node?.control ?? this.deps.peekControl(type);
    if (!ctl) return;
    let stale = false;
    if (event !== '$mount' && ctl.event) {
      const ctx = this.ctx(id, {
        payload: payload ?? {},
        requestStale: () => {
          stale = true;
        },
      });
      try {
        await ctl.event(ctx, { event, payload: payload ?? {} });
      } catch (err) {
        console.error(
          `[${id}] control event "${event}" failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (stale) {
      await this.deps.markStale(id);
      for (const d of this.deps.downstream(id)) await this.deps.markStale(d);
    }
    this.deps.setState(id, await this.statePatch(id));
  }
}
