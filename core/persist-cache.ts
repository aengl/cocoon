/**
 * Persist-cache: binary (v8.serialize) writer and reader.
 *
 * The whole port map is serialised with `v8.serialize` — Node's structured-
 * clone wire format — into one payload, written behind a small fixed-size
 * binary header that carries the module fingerprint the cache was produced
 * under:
 *
 *   ┌────────┬─────────┬───────┬──────────────────┬──────────────┐
 *   │ "COCN" │ version │ flags │ fingerprint f64  │  v8 payload… │
 *   │ 4 B    │ 1 B (2) │ 1 B   │ 8 B little-endian │   variable   │
 *   └────────┴─────────┴───────┴──────────────────┴──────────────┘
 *
 * vs the former streamed-JSON format this is faster to restore (native
 * deserialize, no character-by-character parse), smaller on disk, preserves
 * Dates / Maps / typed arrays, and lifts the ceiling from V8's ~536 MiB single-
 * string cap to the ~2 GiB Buffer cap — so a 153k-row port that overflowed
 * `JSON.stringify`/`JSON.parse` now round-trips.
 *
 * The fingerprint lives in the header of the same file (no sidecar): it is
 * created, replaced, and deleted atomically with the data it describes — zero
 * orphans to clean up. Restore compares it to the module's *current* closure
 * mtime (`NodeResolver.currentMtime`) and treats any mismatch — or a legacy
 * (pre-header / JSON) cache, whose first bytes don't match the magic — as a
 * miss: the caller recomputes and the fresh cache is rewritten in this form.
 */
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import v8 from 'node:v8';

const MAGIC = 'COCN';
const VERSION = 2;
const HEADER_BYTES = 14; // 4 magic + 1 version + 1 flags + 8 fingerprint
const FLAG_HAS_FINGERPRINT = 1;

function buildHeader(fingerprint?: number): Buffer {
  const head = Buffer.alloc(HEADER_BYTES);
  head.write(MAGIC, 0, 'ascii');
  head.writeUInt8(VERSION, 4);
  const has = typeof fingerprint === 'number' && Number.isFinite(fingerprint);
  head.writeUInt8(has ? FLAG_HAS_FINGERPRINT : 0, 5);
  head.writeDoubleLE(has ? (fingerprint as number) : 0, 6);
  return head;
}

/** Parse the fixed header from a buffer ≥ HEADER_BYTES. Returns the fingerprint
 *  (or `undefined` for none / a non-COCN-v2 buffer). The second tuple element
 *  flags whether the buffer is a valid v2 cache at all — distinguishing
 *  "valid cache, no fingerprint" from "legacy / not our format". */
function parseHeader(buf: Buffer): { ok: boolean; fingerprint?: number } {
  if (
    buf.length < HEADER_BYTES ||
    buf.toString('ascii', 0, 4) !== MAGIC ||
    buf.readUInt8(4) !== VERSION
  )
    return { ok: false };
  const flags = buf.readUInt8(5);
  if (!(flags & FLAG_HAS_FINGERPRINT)) return { ok: true };
  const f = buf.readDoubleLE(6);
  return { ok: true, fingerprint: Number.isFinite(f) ? f : undefined };
}

/** Write `ports` as `header + v8.serialize(ports)`. `fingerprint` is the node's
 *  module closure mtime (omit / non-finite ⇒ no fingerprint stored, which
 *  always reads back as a miss). Header and payload are written sequentially so
 *  no full-file copy is materialised for a multi-hundred-MiB payload. */
export async function writePersistedCache(
  filePath: string,
  ports: Record<string, unknown>,
  fingerprint?: number
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = v8.serialize(ports);
  const fh = await open(filePath, 'w');
  try {
    await fh.write(buildHeader(fingerprint));
    await fh.write(payload);
  } finally {
    await fh.close();
  }
}

/**
 * Cheap head-read of the header's fingerprint — reads only the leading bytes,
 * never the (possibly multi-hundred-MiB) payload. Returns `undefined` for a
 * missing file, a legacy (pre-header) cache, or a header with no fingerprint —
 * all of which restore treats as a miss.
 */
export async function readCacheFingerprint(
  filePath: string
): Promise<number | undefined> {
  try {
    const fh = await open(filePath, 'r');
    try {
      const buf = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
      return parseHeader(buf.subarray(0, bytesRead)).fingerprint;
    } finally {
      await fh.close();
    }
  } catch {
    return undefined; // missing / unreadable
  }
}

/**
 * Read a cache written by `writePersistedCache` back into a port map. Rejects
 * on a missing file or a buffer that isn't a valid v2 cache — callers treat
 * that as a miss and recompute.
 *
 * `onBytes` (kept for API compatibility with the former streamed reader) is
 * invoked once with the payload size; the deserialize itself is a single native
 * call, so there is no incremental byte progress to report.
 */
export async function readPersistedCache(
  filePath: string,
  onBytes?: (total: number) => void
): Promise<Record<string, unknown>> {
  const buf = await readFile(filePath);
  const header = parseHeader(buf);
  if (!header.ok) throw new Error('not a Cocoon v2 persist cache');
  const payload = buf.subarray(HEADER_BYTES);
  onBytes?.(payload.length);
  const value = v8.deserialize(payload);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('cache payload is not a port object');
  return value as Record<string, unknown>;
}
