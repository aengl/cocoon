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
  /**
   * Optional slash-path declaring which (possibly nested) visual group this
   * node belongs to, e.g. `Crawl/Amazon`. Semantic (which cluster a node is
   * in, like its `type` is what kind of operation it is). The editor turns
   * each distinct path into a Dagre compound cluster + a Svelte Flow group
   * node; nesting falls out of the path. Hand-authored. The legacy location
   * was `editor.group`, still accepted on read.
   */
  group?: string;
  /**
   * Legacy `editor:` block. The only key still relevant is `actions` (the
   * hand-authored "run this shell command" dropdown — no UI consumer in the
   * prototype yet, but tibi uses it). `col`/`row` and `group` were also
   * here historically; the loader still accepts `editor.group` for older
   * files. There is no serializer, so the editor never rewrites a file —
   * legacy keys persist on disk until the human or the AI rewrites them.
   */
  editor?: {
    actions?: CocoonNodeActions;
    col?: number;
    row?: number;
    group?: string;
  };
  in?: { [portId: string]: unknown };
  out?: { [portId: string]: unknown };
  persist?: boolean;
  type: string;
  /** Any other keys (legacy `view:`/`viewState:`, hand-authored extras)
   *  are simply ignored by the loader — there is no writer to lose them. */
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
