import type { Edge, Node } from '@xyflow/svelte';
import { parse, stringify } from 'yaml';
import {
  extractEdges,
  type CocoonFile,
  type CocoonNodeDefinition,
} from './cocoon-file';
import { formatCocoonUri, parseCocoonUri } from './cocoon-uri';
import type { Callout, NodeState } from './protocol';

/**
 * Loader/serializer for Cocoon definition files.
 *
 * Backwards-compatibility contract: the editor "owns" only graph topology
 * (`in:` cocoon:// references). EVERYTHING else — `'?'`, `description`,
 * `env`, `persist`, `out`, literal `in` params (code strings, nested
 * objects/arrays), `editor.actions`, legacy `view:`/`viewState:`, and any
 * unknown keys — is round-tripped verbatim by cloning the parsed file and
 * mutating only what we own.
 *
 * What we *also* own (the two co-evolution edits the file gets on write):
 *  1. `group:` lifts to a top-level node key. Legacy `editor.group` is
 *     still *read* (back-compat); the serializer always writes the
 *     top-level form and strips the legacy slot.
 *  2. `editor.col/row` are dropped. The auto-layout (Dagre) owns display
 *     now, so the legacy grid position has no consumer — keeping it would
 *     just be churn for hand-authored files that never grow it back.
 *
 * The legacy `editor:` block is therefore reduced to `actions?` (the only
 * key with no current home); when it ends up empty after pruning, the
 * block is dropped. Once `actions` finds a UI consumer (or moves up), the
 * `editor:` key disappears entirely.
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
  /** Slash-path visual group, hand-authored at the top level of a node
   *  (legacy `editor.group` also accepted on read). Display-only hint. */
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
  /** Agent-announced callouts targeting this node, each carrying the editor-
   *  assigned short label (`C1`/…) so the badge needs no extra lookup. App
   *  merges these in the same effect that swaps `runtime`. */
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

  // Positions are arbitrary: App.svelte's Dagre `layout()` pass overwrites
  // them on the next tick. We still need *some* position so xyflow doesn't
  // reject the node — `{0,0}` is fine, the user never sees it.
  const nodes: CocoonFlowNode[] = Object.entries(file.nodes).map(
    ([id, def]) => {
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
        position: { x: 0, y: 0 },
        data: {
          label: id,
          nodeType: def.type,
          doc: def['?'] ?? def.description,
          persist: def.persist,
          params,
          actions: def.editor?.actions,
          // Top-level `group:` is the canonical home; legacy `editor.group`
          // is still honoured on read so files that haven't migrated still
          // cluster correctly.
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

    // --- group: lift from legacy `editor.group` to the top-level key ---
    // If the file already has `group:` at the top level, structuredClone has
    // already kept it. If only the legacy slot was set, copy it up. Either
    // way, the legacy `editor.group` is stripped below.
    if (def.group === undefined && def.editor?.group !== undefined) {
      def.group = def.editor.group;
    }

    // --- editor: prune legacy keys (col/row dropped, group lifted) ---
    // Auto-layout (Dagre) owns display: keeping col/row is pure churn for
    // files that never had them. Drop the `editor:` block entirely if it
    // becomes empty after pruning. Anything else under `editor:` (actions
    // is the only documented survivor) round-trips verbatim.
    if (def.editor) {
      const { col, row, group, ...rest } = def.editor;
      void col;
      void row;
      void group;
      if (Object.keys(rest).length) def.editor = rest;
      else delete def.editor;
    }
  }

  return stringify(out);
}
