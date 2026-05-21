/**
 * Faithful port of the legacy grammar — the regex is copied verbatim from
 * `@cocoon/util/parseCocoonUri` so that every existing `cocoon.yml` parses
 * identically. Do not "improve" it.
 */

export interface PortInfo {
  /** true => the legacy `in/...` form, false => `out/...` (the normal case). */
  incoming: boolean;
  name: string;
}

const URI_RE = /cocoon:\/\/(?<id>[^\/]+)\/(?<inout>[^\/]+)\/(?<port>.+)/;

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
