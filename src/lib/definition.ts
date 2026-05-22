import type { Edge, Node } from '@xyflow/svelte';
import { parse } from 'yaml';
import { extractEdges, type CocoonFile } from './cocoon-file';
import { parseCocoonUri } from './cocoon-uri';
import type { Callout, NodeState } from './protocol';

/**
 * Reader for Cocoon definition files. There is no serializer — the editor is
 * a viewer, and the file is written only by the human (in their text editor)
 * or the AI (via raw `Edit`/`Write`). Both edit YAML as YAML.
 *
 * Back-compat on read: `group:` is canonical, but legacy `editor.group` is
 * still accepted so older files cluster correctly without a migration.
 */

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

export interface CocoonNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  doc?: string;
  persist?: boolean;
  /** Literal (non-edge) `in` entries, preserved and shown read-only. */
  params: Record<string, unknown>;
  actions?: Record<string, string>;
  /** Slash-path visual group. Hand-authored display-only hint; legacy
   *  `editor.group` also accepted on read. */
  group?: string;
  /**
   * YAML-declared ports, in file order.
   *
   * - `inPorts`: only `in:` keys whose value is a `cocoon://` edge. A purely
   *   literal `in:` value is configuration, not a port (lives in `params`,
   *   no handle drawn).
   * - `outPorts`: every `out:` key, plus any output port surfaced by an
   *   edge.
   *
   * Registry-free: node-type port schemas are never consulted. The
   * grammar's edge-vs-literal split is the sole discriminator.
   */
  inPorts: string[];
  outPorts: string[];
  /** Live processing state streamed from the core (undefined = offline). */
  runtime?: NodeState;
  /** Agent-announced callouts pinned to this node, each carrying the
   *  editor-assigned short label (`C1`/…). */
  callouts?: (Callout & { label?: string })[];
}

export type CocoonFlowNode = Node<CocoonNodeData>;

export interface LoadedGraph {
  file: CocoonFile;
  nodes: CocoonFlowNode[];
  edges: Edge[];
}

export function loadCocoonFile(yaml: string): LoadedGraph {
  const file = parse(yaml) as CocoonFile;
  if (!file.nodes) file.nodes = {};

  const cocoonEdges = extractEdges(file);

  const inPorts = new Map<string, string[]>();
  const outPorts = new Map<string, string[]>();
  for (const [id, def] of Object.entries(file.nodes)) {
    inPorts.set(
      id,
      Object.entries(def.in ?? {})
        .filter(([, raw]) => asArray(raw).some(v => parseCocoonUri(v)))
        .map(([key]) => key)
    );
    outPorts.set(id, Object.keys(def.out ?? {}));
  }
  for (const e of cocoonEdges) {
    // `e.to`/`e.toPort` is already an `in:` key; only a producer's output
    // port may be absent (rarely declared in `out:`).
    const outs = outPorts.get(e.from);
    if (outs) {
      if (!outs.includes(e.fromPort)) outs.push(e.fromPort);
    } else {
      outPorts.set(e.from, [e.fromPort]);
    }
  }

  // Positions are placeholders — App's `layout()` overwrites them on the
  // next tick. xyflow rejects nodes without a position; `{0,0}` is fine.
  const nodes: CocoonFlowNode[] = Object.entries(file.nodes).map(
    ([id, def]) => {
      const params: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(def.in ?? {})) {
        const literals = asArray(raw).filter(v => !parseCocoonUri(v));
        if (literals.length) {
          params[key] = literals.length === 1 ? literals[0] : literals;
        }
      }

      return {
        id,
        type: 'cocoon',
        position: { x: 0, y: 0 },
        data: {
          label: id,
          nodeType: def.type,
          doc: def['?'] ?? def.description,
          persist: def.persist,
          params,
          actions: def.editor?.actions,
          group: def.group ?? def.editor?.group,
          inPorts: inPorts.get(id) ?? [],
          outPorts: outPorts.get(id) ?? [],
        },
      } satisfies CocoonFlowNode;
    }
  );

  const edges: Edge[] = cocoonEdges.map(e => ({
    id: `${e.from}.${e.fromPort}->${e.to}.${e.toPort}`,
    source: e.from,
    target: e.to,
    sourceHandle: e.fromPort,
    targetHandle: e.toPort,
  }));

  return { file, nodes, edges };
}
