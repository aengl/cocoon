import type { Edge, Node } from '@xyflow/svelte';
import { parse } from 'yaml';
import { extractEdges, type CocoonFile } from './cocoon-file';
import { parseCocoonUri } from './cocoon-uri';
import type { Callout, NodeState } from './protocol';

/**
 * Loader for Cocoon definition files.
 *
 * There is **no serializer**: the editor is a viewer, not a writer. The two
 * effective writers of `cocoon.yml` are the human (in their own text editor,
 * side-by-side with the canvas) and the AI (via raw `Edit`/`Write` against
 * the file text). Both bypass any structural model — they edit YAML as
 * YAML. That removes the entire "lossless round-trip" surface: there is
 * nothing in the runtime that could be lossy, because nothing in the
 * runtime writes. Unknown keys, legacy `view:`/`viewState:`, hand-authored
 * extras — all preserved by the only mechanism that matters: the file
 * isn't touched.
 *
 * The loader still honours back-compat on **read**: `group:` is the
 * canonical top-level node key, but the legacy `editor.group` is still
 * accepted so older files cluster correctly without a migration. Same
 * applies to anything else we ever choose to lift — the loader is the
 * single source of "how a file means".
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
