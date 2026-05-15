/**
 * The node-author contract. A faithful trim of legacy `@cocoon/types`
 * `CocoonNode` / `CocoonNodeContext`: a node is a plain Node.js module
 * exporting a `process` async generator that reads input ports, writes output
 * ports, yields progress, and *returns* a one-line summary string.
 *
 * Kept registry-free and UI-free on purpose — this file imports nothing.
 */

/** Legacy `Progress`: a message, a 0..1 fraction, both, or nothing. */
export type Progress = string | number | [string, number] | void;

export interface ProcessContext {
  /** Resolved inputs: literal `in:` params merged with upstream port data. */
  ports: {
    read(): Record<string, unknown>;
    write(data: Record<string, unknown>): void;
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
  process(context: ProcessContext): AsyncGenerator<Progress, string | void, void>;
}

export type Registry = Record<string, CocoonProcessNode>;
