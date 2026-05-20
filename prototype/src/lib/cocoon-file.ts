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
   * in, like its `type` is what kind of operation it is) — *not* an editor-
   * housing concern, so it sits at the node level alongside `type`/`in`/
   * `out`/`persist`. The editor turns each distinct path into a Dagre
   * compound cluster + a Svelte Flow group node; nesting falls out of the
   * path. Read-only for now: hand-authored in YAML, preserved verbatim on
   * round-trip. The legacy location was `editor.group` — the loader still
   * accepts it for one mercy release; the serializer always writes the
   * top-level form.
   */
  group?: string;
  /**
   * Legacy `editor:` block. The only key still meaningful is `actions`
   * (the hand-authored "run this shell command" dropdown — no UI consumer
   * in the prototype yet, but tibi uses it; preserved verbatim). `col`/
   * `row` were the legacy grid position; the auto-layout (Dagre) is the
   * sole owner of display now, so they are dropped on round-trip rather
   * than preserved. `group` has moved up to the node-level `group:` key
   * above; the loader reads `editor.group` for back-compat, the serializer
   * strips it. The whole `editor:` block disappears once `actions` finds a
   * UI consumer (or a better home).
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
  /**
   * Any other keys (legacy `view:`/`viewState:`, hand-authored extras) are
   * preserved verbatim on round-trip: the serializer deep-clones the parsed
   * file and mutates only the keys it owns (`in:` edges + `group:` lift +
   * the legacy-`editor` pruning), so unknown keys survive untouched without
   * the loader needing to model them.
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
