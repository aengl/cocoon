/**
 * Mirrors legacy `@cocoon/types` CocoonFile / CocoonNodeDefinition exactly,
 * minus runtime-only fields. Kept plain on purpose: the node *library* is
 * loaded as JS (TS types stripped by Node at runtime), so the YAML layer must
 * NOT depend on node-type port schemas — it is registry-free and structural.
 */

export type CocoonNodeActions = { [label: string]: string };

export interface CocoonNodeDefinition {
  '?'?: string;
  description?: string;
  editor?: {
    actions?: CocoonNodeActions;
    col?: number;
    row?: number;
    /**
     * Optional slash-path declaring which (possibly nested) visual group
     * this node belongs to, e.g. `Crawl/Amazon`. Purely a presentation
     * hint — like `col`/`row` it lives under `editor:` and never touches
     * edges, ports or execution. Read-only for now: hand-authored in YAML,
     * preserved verbatim on round-trip (the serializer owns only `in:` +
     * `editor.col/row`), and consumed only by the editor's display layout.
     */
    group?: string;
  };
  in?: { [portId: string]: unknown };
  out?: { [portId: string]: unknown };
  persist?: boolean;
  type: string;
  /**
   * Any other keys (legacy `view:`/`viewState:`, hand-authored extras) are
   * preserved verbatim on round-trip: the serializer deep-clones the parsed
   * file and mutates only `in:` edges + `editor.col/row`, so unknown keys
   * survive untouched without the loader needing to model them.
   */
  [extra: string]: unknown;
}

export interface CocoonFile {
  env?: Record<string, unknown>;
  description?: string;
  nodes: { [nodeId: string]: CocoonNodeDefinition };
  /** Any unknown top-level keys are preserved here for lossless round-trips. */
  [extra: string]: unknown;
}

export interface CocoonEdge {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

/**
 * Structural edge extraction — a direct port of legacy
 * `graph.ts#createEdgesForNode`. An `in` value may be a single value or an
 * array; every element that parses as a `cocoon://` uri is an edge, everything
 * else is a literal parameter and is ignored here (but preserved on write).
 */
import { parseCocoonUri } from './cocoon-uri.ts';

export function extractEdges(file: CocoonFile): CocoonEdge[] {
  const edges: CocoonEdge[] = [];
  for (const [nodeId, def] of Object.entries(file.nodes ?? {})) {
    if (!def.in) continue;
    for (const [toPort, raw] of Object.entries(def.in)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        const parsed = parseCocoonUri(v);
        if (!parsed) continue;
        edges.push({
          from: parsed.id,
          fromPort: parsed.port.name,
          to: nodeId,
          toPort,
        });
      }
    }
  }
  return edges;
}
