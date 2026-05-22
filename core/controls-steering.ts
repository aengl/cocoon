/**
 * Steering controls (keystone 5, steering tier): typed knobs declared in
 * node code, overlaid at runtime. The overlay never reaches YAML; setting
 * a knob ages the node (and its downstream) `stale`, never re-runs.
 */
import type { ControlSchema, NodeState } from '../src/lib/protocol.ts';

/** Value before the editor/agent first touches a knob: declared `default`,
 *  else the kind's natural zero. */
function controlDefault(c: ControlSchema): unknown {
  switch (c.kind) {
    case 'toggle':
      return c.default ?? false;
    case 'select':
      return c.default ?? c.options[0];
    case 'text':
      return c.default ?? '';
    case 'number':
      return c.default ?? c.min ?? 0;
  }
}

/** Whether `v` is acceptable for control `c`. Invalid writes are dropped
 *  silently by `set` — `process()` never sees a bad value. */
function controlValid(c: ControlSchema, v: unknown): boolean {
  switch (c.kind) {
    case 'toggle':
      return typeof v === 'boolean';
    case 'select':
      return typeof v === 'string' && c.options.includes(v);
    case 'text':
      return typeof v === 'string';
    case 'number':
      return (
        typeof v === 'number' &&
        Number.isFinite(v) &&
        (c.min === undefined || v >= c.min) &&
        (c.max === undefined || v <= c.max)
      );
  }
}

export interface SteeringDeps {
  schemaOf(id: string): Record<string, ControlSchema> | undefined;
  hasNode(id: string): boolean;
  setState(id: string, patch: Partial<NodeState>): void;
  markStale(id: string): Promise<void>;
  downstream(id: string): string[];
}

export class SteeringControls {
  /** Session overlay: id → key → value. Reset on restart, never YAML. */
  private overrides = new Map<string, Record<string, unknown>>();
  private deps: SteeringDeps;

  constructor(deps: SteeringDeps) {
    this.deps = deps;
  }

  /** Effective values exposed to `ctx.controls.read()`. */
  effective(
    id: string,
    schema: Record<string, ControlSchema>
  ): Record<string, unknown> {
    const ov = this.overrides.get(id) ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(schema))
      out[k] = k in ov ? ov[k] : controlDefault(c);
    return out;
  }

  /** The `{controls, controlState}` slice for node-state. `{}` when the node
   *  declares no controls or its module hasn't resolved yet. */
  patch(id: string): Partial<NodeState> {
    const schema = this.deps.schemaOf(id);
    if (!schema || !Object.keys(schema).length) return {};
    return { controls: schema, controlState: this.effective(id, schema) };
  }

  /**
   * Set one steering value. Validates against the schema (unknown node/key,
   * wrong shape, or unresolved schema is a silent no-op) and records the
   * value in the session overlay. Ages the node + downstream `stale` —
   * never re-runs, the user pulls.
   *
   * No-op when the *effective* value is unchanged: re-selecting the current
   * value in a dropdown must not age the node. The comparison is on the
   * effective value (current override OR schema default), so picking the
   * default with no prior override is also recognised as a no-op.
   */
  async set(id: string, key: string, value: unknown): Promise<void> {
    if (!this.deps.hasNode(id)) return;
    const cs = this.deps.schemaOf(id)?.[key];
    if (!cs || !controlValid(cs, value)) return;
    const cur = this.overrides.get(id) ?? {};
    const effective = key in cur ? cur[key] : controlDefault(cs);
    if (effective === value) return;
    this.overrides.set(id, { ...cur, [key]: value });
    await this.deps.markStale(id);
    for (const d of this.deps.downstream(id)) await this.deps.markStale(d);
    this.deps.setState(id, this.patch(id));
  }

  /** Drop overlays for removed nodes (called from reload). */
  forgetMissing(present: Set<string>): void {
    for (const id of [...this.overrides.keys()])
      if (!present.has(id)) this.overrides.delete(id);
  }
}
