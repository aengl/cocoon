/**
 * Mirrors legacy `@cocoon/types` CocoonFile / CocoonNodeDefinition exactly,
 * minus runtime-only fields. Kept plain on purpose: the YAML layer must not
 * depend on node-type port schemas — it is registry-free and structural.
 */

export type CocoonNodeActions = { [label: string]: string };

export interface CocoonNodeDefinition {
  '?'?: string;
  description?: string;
  /** Slash-path declaring the visual group this node belongs to, e.g.
   *  `Crawl/Amazon`. Hand-authored. Legacy location was `editor.group`,
   *  still accepted on read. */
  group?: string;
  /** Legacy `editor:` block. Only `actions` is still consumed (the
   *  hand-authored "run this shell command" dropdown). `col`/`row`/`group`
   *  were historical; the loader still accepts `editor.group`. */
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
  /** Unknown keys (legacy `view:`/`viewState:`, hand-authored extras) are
   *  ignored by the loader — there is no writer to lose them. */
  [extra: string]: unknown;
}

/** Per-group display intent, keyed by the same slash-path nodes use in
 *  `group:`. Authored, optional, presentation-only — the peer of `group:`,
 *  not graph wiring. Currently just a default collapse state (seeds the
 *  editor; runtime toggles override it without rewriting the file, exactly
 *  like `persist`). A home for future group metadata (colour, order, …). */
export interface CocoonGroupDefinition {
  collapsed?: boolean;
  [extra: string]: unknown;
}

export interface CocoonFile {
  env?: Record<string, unknown>;
  description?: string;
  nodes: { [nodeId: string]: CocoonNodeDefinition };
  groups?: { [groupPath: string]: CocoonGroupDefinition };
  [extra: string]: unknown;
}

export interface CocoonEdge {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

import { parseCocoonUri } from './cocoon-uri.ts';

/**
 * Structural edge extraction. An `in` value may be a single value or an
 * array; every element that parses as a `cocoon://` uri is an edge, the rest
 * is a literal parameter and is ignored here.
 */
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
