import type { Edge, Node } from '@xyflow/svelte';
import { parse, stringify } from 'yaml';
import {
  extractEdges,
  type CocoonFile,
  type CocoonNodeDefinition,
} from './cocoon-file';
import {
  formatCocoonUri,
  parseCocoonUri,
  parseViewString,
  type PortInfo,
} from './cocoon-uri';
import type { NodeState } from './protocol';

/**
 * Loader/serializer for Cocoon definition files.
 *
 * Backwards-compatibility contract: the editor "owns" only graph topology
 * (`in:` cocoon:// references) and node position (`editor.col/row`).
 * EVERYTHING else — `'?'`, `description`, `env`, `persist`, `out`,
 * `viewState`, literal `in` params (code strings, nested objects/arrays),
 * `editor.actions`, and any unknown keys — is round-tripped verbatim by
 * cloning the parsed file and mutating only what we own.
 *
 * Legacy used a grid (`editor.col/row`); Svelte Flow uses pixels. We map
 * between them and only write `editor` back when it already existed or the
 * user actually moved the node, so untouched files don't churn.
 */

const COL_W = 320;
const ROW_H = 240;

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

export interface CocoonNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  doc?: string;
  persist?: boolean;
  /** Literal (non-edge) `in` entries, preserved and shown read-only. */
  params: Record<string, unknown>;
  view?: { type: string; port?: PortInfo };
  viewState: unknown;
  actions?: Record<string, string>;
  /** All YAML-declared ports — every `in:`/`out:` key (edge or literal),
   *  plus output ports surfaced by an edge, in file order. Still
   *  registry-free: node-type port schemas are never consulted. */
  inPorts: string[];
  outPorts: string[];
  /** Live processing state streamed from the core (undefined = offline). */
  runtime?: NodeState;
  // Round-trip bookkeeping (not serialised):
  hadEditorPos: boolean;
  autoCol: number;
  autoRow: number;
}

export type CocoonFlowNode = Node<CocoonNodeData>;

export interface LoadedGraph {
  file: CocoonFile;
  nodes: CocoonFlowNode[];
  edges: Edge[];
}

/** Longest-path layout for nodes without an explicit `editor.col/row`. */
function autoLayout(
  file: CocoonFile,
  edges: { from: string; to: string }[]
): Map<string, { col: number; row: number }> {
  const ids = Object.keys(file.nodes ?? {}).sort();
  const incoming = new Map<string, string[]>();
  for (const id of ids) incoming.set(id, []);
  for (const e of edges) incoming.get(e.to)?.push(e.from);

  const depthCache = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    const d = parents.length
      ? Math.max(...parents.map(p => depth(p, seen) + 1))
      : 0;
    depthCache.set(id, d);
    return d;
  };

  const rowCounter = new Map<number, number>();
  const out = new Map<string, { col: number; row: number }>();
  for (const id of ids) {
    const col = depth(id);
    const row = rowCounter.get(col) ?? 0;
    rowCounter.set(col, row + 1);
    out.set(id, { col, row });
  }
  return out;
}

export function loadCocoonFile(yaml: string): LoadedGraph {
  const file = parse(yaml) as CocoonFile;
  if (!file.nodes) file.nodes = {};

  const cocoonEdges = extractEdges(file);
  const auto = autoLayout(file, cocoonEdges);

  // Node-type port *schemas* are still never read here — the YAML layer
  // stays registry-free. But the YAML *structure* declares ports: every
  // `in:` key is an input port (whether its value is a cocoon:// edge or a
  // literal param) and every `out:` key a statically-seeded output port.
  // Edges additionally surface a producer's output ports, which it need
  // not declare in `out:`. We show all of these, in file order.
  const inPorts = new Map<string, string[]>();
  const outPorts = new Map<string, string[]>();
  for (const [id, def] of Object.entries(file.nodes)) {
    inPorts.set(id, Object.keys(def.in ?? {}));
    outPorts.set(id, Object.keys(def.out ?? {}));
  }
  for (const e of cocoonEdges) {
    // `e.to`/`e.toPort` is already an `in:` key; only a producer's output
    // port may be absent (rarely declared in `out:`) — add it.
    const outs = outPorts.get(e.from);
    if (outs) {
      if (!outs.includes(e.fromPort)) outs.push(e.fromPort);
    } else {
      outPorts.set(e.from, [e.fromPort]);
    }
  }

  const nodes: CocoonFlowNode[] = Object.entries(file.nodes).map(
    ([id, def]) => {
      const hadEditorPos = !!(
        def.editor &&
        (def.editor.col !== undefined || def.editor.row !== undefined)
      );
      const a = auto.get(id) ?? { col: 0, row: 0 };
      const col = hadEditorPos ? def.editor!.col ?? 0 : a.col;
      const row = hadEditorPos ? def.editor!.row ?? 0 : a.row;

      // Split `in` into edges (owned) vs literal params (preserved, shown).
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
        position: { x: col * COL_W, y: row * ROW_H },
        data: {
          label: id,
          nodeType: def.type,
          doc: def['?'] ?? def.description,
          persist: def.persist,
          params,
          view: def.view ? parseViewString(def.view) : undefined,
          viewState: def.viewState,
          actions: def.editor?.actions,
          inPorts: inPorts.get(id) ?? [],
          outPorts: outPorts.get(id) ?? [],
          hadEditorPos,
          autoCol: a.col,
          autoRow: a.row,
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

export function serializeCocoonFile(
  original: CocoonFile,
  nodes: CocoonFlowNode[],
  edges: Edge[]
): string {
  // Clone preserves env / description / unknown top-level keys and every
  // untouched node field.
  const out: CocoonFile = structuredClone(original);
  if (!out.nodes) out.nodes = {};

  for (const node of nodes) {
    const def: CocoonNodeDefinition = out.nodes[node.id] ?? {
      type: node.data.nodeType,
    };
    out.nodes[node.id] = def;

    // --- in: keep literal params verbatim, re-derive edge references ---
    const nextIn: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(def.in ?? {})) {
      const literals = asArray(raw).filter(v => !parseCocoonUri(v));
      if (literals.length) {
        nextIn[key] = literals.length === 1 ? literals[0] : literals;
      }
    }
    for (const edge of edges.filter(e => e.target === node.id)) {
      const port = edge.targetHandle ?? 'data';
      const uri = formatCocoonUri(edge.source, edge.sourceHandle ?? 'data');
      if (nextIn[port] === undefined) {
        nextIn[port] = uri;
      } else {
        const merged = [...asArray(nextIn[port]), uri];
        nextIn[port] = [...new Set(merged)];
      }
    }
    if (Object.keys(nextIn).length) def.in = nextIn;
    else delete def.in;

    // --- position: only write editor when it existed or node was moved ---
    const col = Math.round(node.position.x / COL_W);
    const row = Math.round(node.position.y / ROW_H);
    const moved =
      col !== node.data.autoCol || row !== node.data.autoRow;
    if (node.data.hadEditorPos || moved) {
      def.editor = { ...(def.editor ?? {}), col, row };
    }
  }

  return stringify(out);
}
