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
  /** Absolute path of the cocoon.yml — nodes resolve relative files against it. */
  cocoonFilePath: string;
  nodeId: string;
}

export interface CocoonProcessNode {
  category?: string;
  description?: string;
  /** Default to caching this node's output to disk (overridable per-node). */
  persist?: boolean;
  /** Legacy `defaultPort` (kept for parity; unused until views land). */
  defaultPort?: { incoming: boolean; name: string };
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
  process(context: ProcessContext): AsyncGenerator<Progress, string | void, void>;
}

export type Registry = Record<string, CocoonProcessNode>;
