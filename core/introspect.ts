/**
 * AI-facing read surface over a live Runtime. Transport-agnostic. Every
 * function returns counts / shapes / bounded digests — never bulk port
 * data. Output size tracks schema width + `limit`, never row count.
 */
import { castFunction } from './cast-function.ts';
import type { Runtime } from './runtime.ts';
import { parseCocoonUri } from '../src/lib/cocoon-uri.ts';
import type { NodeStatus } from '../src/lib/protocol.ts';

const STR_CAP = 60;
const isCode = (s: string) => /=>|\bfunction\b|\n/.test(s);

/**
 * Bounded, shape-preserving digest of any value. Code strings and bulk
 * arrays/objects collapse to labelled stubs; output stays a near-constant
 * size. Used by node params, on-throw `inputDigest`, and `peek` samples.
 */
export interface DigestOpts {
  /** Field names rendered without the usual array-collapse (one level
   *  deep, capped at `expandCap`). Each element is digested with the
   *  standard depth budget. */
  expand?: Set<string>;
  /** Internal: set while recursing into an `expand`ed field; reset before
   *  passing to grandchildren so the carve-out stays single-level. */
  noCollapse?: boolean;
  /** Element cap per expanded array. Default 50. */
  expandCap?: number;
}

export function digest(v: unknown, depth = 0, opts: DigestOpts = {}): unknown {
  if (v === null || v === undefined) return v ?? null;
  const t = typeof v;
  if (t === 'number' || t === 'boolean') return v;
  if (t === 'bigint') return `${v}n`;
  if (t === 'function') return '‹fn›';
  if (t === 'symbol') return v.toString();
  if (t === 'string') {
    const s = v as string;
    if (s.length <= STR_CAP) return s;
    const kind = isCode(s) ? 'code' : 'string';
    return `‹${kind} ${s.length}c: ${JSON.stringify(s.slice(0, 48))}…›`;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    const head = v[0];
    const shape =
      head && typeof head === 'object'
        ? `{${Object.keys(head).slice(0, 8).join(',')}}`
        : typeof head;
    if (opts.noCollapse) {
      const cap = opts.expandCap ?? 50;
      const inner = { expand: opts.expand, expandCap: opts.expandCap };
      // Fresh depth budget per element; grandchildren still bound by the
      // default depth-2 collapse.
      const out = v.slice(0, cap).map(x => digest(x, 0, inner));
      return v.length > cap ? [...out, `…+${v.length - cap} more`] : out;
    }
    return depth === 0 && v.length <= 3
      ? v.map(x => digest(x, depth + 1, { expand: opts.expand, expandCap: opts.expandCap }))
      : `‹array [${shape}] ×${v.length}›`;
  }
  const keys = Object.keys(v as object);
  if (depth >= 2)
    return `‹object {${keys.slice(0, 6).join(',')}${
      keys.length > 6 ? ',…' : ''
    }} (${keys.length} keys)›`;
  const o: Record<string, unknown> = {};
  for (const k of keys.slice(0, 12)) {
    const childOpts: DigestOpts =
      opts.expand?.has(k)
        ? { expand: opts.expand, noCollapse: true, expandCap: opts.expandCap }
        : { expand: opts.expand, expandCap: opts.expandCap };
    o[k] = digest((v as never)[k], depth + 1, childOpts);
  }
  if (keys.length > 12) o['…'] = `+${keys.length - 12} more keys`;
  return o;
}

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try {
      JSON.parse(v);
      return 'json-string';
    } catch {
      /* not actually JSON */
    }
  }
  return typeof v;
};

export interface PeekOptions {
  descend?: string;
  where?: string;
  select?: string[];
  limit?: number;
  /** Field names rendered fully in `sample` rows. Schema `example` stays
   *  bounded; this is the row-level escape hatch. */
  expand?: string[];
}

const SCAN_CAP = 500;
// Default tiny — the schema already describes shape across rows. `limit`
// (up to 100) opts into a real slice via where/select.
const SAMPLE_DEFAULT = 3;

/**
 * Summarise a port's data. Schema = per-key type set (with JSON-string
 * detection) + presence + digested example. `where`/`select`/`limit` carve
 * a bounded slice; `descend` follows a JSON-string column one level in.
 */
export function peekData(data: unknown, opts: PeekOptions = {}) {
  const rows: unknown[] = Array.isArray(data)
    ? data
    : data === undefined
      ? []
      : [data];
  const kind = Array.isArray(data)
    ? 'array'
    : data === undefined
      ? 'empty'
      : 'single';

  let scope = rows.slice(0, SCAN_CAP);
  let matched: number | undefined;
  let whereError: string | undefined;
  if (opts.where) {
    const pred = castFunction<(...a: unknown[]) => unknown>(opts.where);
    if (!pred) whereError = 'where is not a function';
    else {
      try {
        scope = scope.filter((r, i) => pred(r, i));
        matched = scope.length;
      } catch (err) {
        whereError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const acc = new Map<
    string,
    { types: Set<string>; n: number; example: unknown }
  >();
  for (const r of scope) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, val] of Object.entries(r)) {
      let e = acc.get(k);
      if (!e) acc.set(k, (e = { types: new Set(), n: 0, example: undefined }));
      e.types.add(typeOf(val));
      e.n++;
      if (e.example === undefined && val !== undefined) e.example = val;
    }
  }
  const schemaOut: Record<string, unknown> = {};
  for (const [k, e] of acc)
    schemaOut[k] = {
      type: [...e.types].join('|'),
      presence: `${e.n}/${scope.length}`,
      example: digest(e.example, 1),
    };

  const limit = Math.max(0, Math.min(opts.limit ?? SAMPLE_DEFAULT, 100));
  const project = (r: unknown) => {
    if (!opts.select || !r || typeof r !== 'object') return r;
    const o: Record<string, unknown> = {};
    for (const k of opts.select) o[k] = (r as Record<string, unknown>)[k];
    return o;
  };
  const expandSet =
    opts.expand && opts.expand.length > 0 ? new Set(opts.expand) : undefined;
  const sample = scope
    .slice(0, limit)
    .map(r => digest(project(r), 0, { expand: expandSet }));

  const result: Record<string, unknown> = {
    kind,
    rows: rows.length,
    scanned: Math.min(rows.length, SCAN_CAP),
    schema: schemaOut,
    sample,
  };
  if (matched !== undefined) result.matched = matched;
  if (whereError) result.whereError = whereError;

  if (opts.descend) {
    const raw = scope
      .map(r => (r as Record<string, unknown> | null)?.[opts.descend!])
      .find(x => typeof x === 'string' && x.length > 0) as string | undefined;
    try {
      const inner = JSON.parse(raw ?? '');
      const innerSchema: Record<string, string> = {};
      for (const [k, val] of Object.entries(inner ?? {}))
        innerSchema[k] =
          val && typeof val === 'object'
            ? `${Array.isArray(val) ? 'array' : 'object'} {${Object.keys(
                val
              )
                .slice(0, 8)
                .join(',')}}`
            : typeOf(val);
      result.descended = { field: opts.descend, innerSchema };
    } catch {
      result.descended = {
        field: opts.descend,
        error: 'not a JSON string (nothing to descend)',
      };
    }
  }
  return result;
}

// --- topology over the Runtime's public surface ---------------------------

const incoming = (rt: Runtime, id: string) =>
  rt.edges.filter(e => e.to === id).map(e => e.from);
const outgoing = (rt: Runtime, id: string) =>
  rt.edges.filter(e => e.from === id).map(e => e.to);

function transitive(rt: Runtime, id: string, dir: 'up' | 'down', depth = Infinity) {
  const seen = new Set<string>();
  let frontier = [id];
  let d = 0;
  while (frontier.length && d < depth) {
    const next: string[] = [];
    for (const n of frontier)
      for (const m of dir === 'up' ? incoming(rt, n) : outgoing(rt, n))
        if (!seen.has(m)) {
          seen.add(m);
          next.push(m);
        }
    frontier = next;
    d++;
  }
  return [...seen];
}

export function overview(rt: Runtime) {
  const ids = Object.keys(rt.file.nodes);
  const status: Partial<Record<NodeStatus, number>> = {};
  for (const [, s] of rt.snapshot())
    status[s.status] = (status[s.status] ?? 0) + 1;
  const types: Record<string, number> = {};
  for (const id of ids) {
    const t = rt.file.nodes[id].type;
    types[t] = (types[t] ?? 0) + 1;
  }
  const sources = ids.filter(id => incoming(rt, id).length === 0);
  const sinks = ids.filter(id => outgoing(rt, id).length === 0);
  const out: Record<string, unknown> = {
    file: rt.filePath,
    env: rt.file.env ?? null,
    nodes: ids.length,
    edges: rt.edges.length,
    status,
    sources: sources.length,
    sinks: sinks.length,
    types: Object.fromEntries(
      Object.entries(types).sort((a, b) => b[1] - a[1])
    ),
  };
  if (rt.loadErrors.size)
    out.loadErrors = Object.fromEntries(rt.loadErrors);
  return out;
}

export function nodeDetail(rt: Runtime, id: string) {
  const def = rt.file.nodes[id];
  if (!def) throw new Error(`No such node "${id}"`);
  const state = new Map(rt.snapshot()).get(id);

  const params: Record<string, unknown> = {};
  const inEdges: { port: string; from: string; fromPort: string }[] = [];
  for (const [port, raw] of Object.entries(def.in ?? {})) {
    const arr = Array.isArray(raw) ? raw : [raw];
    for (const v of arr) {
      const u = parseCocoonUri(v);
      if (u) inEdges.push({ port, from: u.id, fromPort: u.port.name });
      else params[port] = digest(v);
    }
  }
  const outEdges = rt.edges
    .filter(e => e.from === id)
    .map(e => ({ port: e.fromPort, to: e.to, toPort: e.toPort }));

  return {
    id,
    type: def.type,
    // Surfaced so the agent can read a free-form control's source file to
    // discover its form field `name`s — the form HTML is built by the node
    // module itself. Lazy: `undefined` until the type has resolved.
    modulePath: rt.moduleFile(def.type),
    description: def['?'] ?? def.description,
    status: state?.status,
    summary: state?.summary,
    error: state?.error,
    errorStack: state?.errorStack,
    errorAt: state?.errorAt,
    inputDigest: state?.inputDigest,
    persist: state?.persist,
    ports: state?.ports,
    controls: state?.controls,
    controlState: state?.controlState,
    // The same bounded slice the human's render sees. Digest defends
    // against a node returning a fat list. Absent ⇒ no free-form control
    // or not yet pulled.
    controlData:
      state?.controlData === undefined ? undefined : digest(state.controlData),
    in: { params, edges: inEdges },
    out: { declared: Object.keys(def.out ?? {}), edges: outEdges },
    upstream: transitive(rt, id, 'up').length,
    downstream: outgoing(rt, id).length,
  };
}

export function relatives(
  rt: Runtime,
  id: string,
  dir: 'up' | 'down',
  depth?: number
) {
  if (!rt.file.nodes[id]) throw new Error(`No such node "${id}"`);
  const states = new Map(rt.snapshot());
  return transitive(rt, id, dir, depth).map(n => ({
    id: n,
    type: rt.file.nodes[n]?.type,
    status: states.get(n)?.status,
  }));
}
