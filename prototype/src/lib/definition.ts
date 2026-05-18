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

export const COL_W = 320;
export const ROW_H = 240;

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
  /** Slash-path visual group from `editor.group` (display-only hint). */
  group?: string;
  /** YAML-declared ports, in file order. `inPorts` = only `in:` keys whose
   *  value is a `cocoon://` edge — a purely literal `in:` value is
   *  configuration, not a port (it lives in `params`, gets no handle).
   *  `outPorts` = every `out:` key plus any output port surfaced by an
   *  edge. Still registry-free: node-type port schemas are never
   *  consulted — the grammar's edge-vs-literal split is the discriminator. */
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
  // stays registry-free. The YAML *structure* declares ports, and the
  // grammar's own edge-vs-literal split is the sole discriminator (no
  // code-declared schema, no per-node config list): an `in:` key is an
  // input **port** only when its value is a `cocoon://` edge. A purely
  // literal `in:` value is **configuration**, not a port — kept verbatim
  // by the lossless contract and shown as the title-line YAML slice, but
  // it gets no connectable handle: piping a config value like
  // `path: ratings.json` from another node is visual-programming theatre
  // (a legacy artefact of having only ports to supply values), not a real
  // use-case. Every `out:` key is a statically-seeded output port; an edge
  // additionally surfaces a producer's output port it need not declare in
  // `out:`. All in file order.
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
          group: def.editor?.group,
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
