/**
 * Faithful ports of the legacy grammar — the regexes are copied verbatim from
 * `@cocoon/util/parseCocoonUri` and `@cocoon/util/parseViewString` so that
 * every existing `cocoon.yml` parses identically. Do not "improve" them.
 */

export interface PortInfo {
  /** true => the legacy `in/...` form, false => `out/...` (the normal case). */
  incoming: boolean;
  name: string;
}

const URI_RE = /cocoon:\/\/(?<id>[^\/]+)\/(?<inout>[^\/]+)\/(?<port>.+)/;
const VIEW_RE = /(?<inout>[^\/]+)\/(?<port>[^\/]+)\/(?<type>.+)/;

/** Parse a port reference. Returns undefined for literal (non-edge) values. */
export function parseCocoonUri(
  value: unknown
): { id: string; port: PortInfo } | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(URI_RE);
  if (!match?.groups) return undefined;
  return {
    id: match.groups.id,
    port: { incoming: match.groups.inout === 'in', name: match.groups.port },
  };
}

/** Legacy writer always emits the `out` form (see definitions.ts). */
export function formatCocoonUri(id: string, port = 'data'): string {
  return `cocoon://${id}/out/${port}`;
}

/** `"Scatterplot"` -> type only; `"out/data/Inspector"` -> typed + port. */
export function parseViewString(
  view: string
): { type: string; port?: PortInfo } {
  const match = view.match(VIEW_RE);
  if (!match?.groups) return { type: view };
  return {
    type: match.groups.type,
    port: {
      incoming: match.groups.inout === 'in',
      name: match.groups.port,
    },
  };
}
