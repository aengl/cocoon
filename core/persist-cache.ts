/**
 * Streamed persist-cache writer and reader.
 *
 * V8 caps strings at ~536 MiB, so `JSON.stringify`/`JSON.parse` of a single
 * large port (e.g. 153k rows / ~542 MiB JSON) overflows and the node is
 * effectively un-cacheable. Both sides here process the cache element-by-
 * element: the writer emits arrays piece-by-piece, the reader is a
 * compacting recursive-descent JSON parser that never holds the file (or
 * any array) as one string.
 *
 * The payload is wrapped in a thin envelope — `{"__cocoon":1,"mtime":<n>,
 * "ports":{…}}` — so each cache carries the module fingerprint it was produced
 * under (max closure mtime; see `NodeResolver.currentMtime`). Restore compares
 * it to the module's *current* fingerprint and treats a mismatch as a miss, so
 * an edited node module is never masked by a stale cache. The fingerprint lives
 * inside the cache file itself (no sidecar): it is created, replaced, and
 * deleted atomically with the data it describes — zero orphans to clean up.
 * Missing/invalid caches reject; the caller treats that as a miss and
 * recomputes. A pre-envelope (legacy) cache has no fingerprint and is treated
 * as a miss, recomputed once, then rewritten in envelope form.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** Write `ports` under the envelope, streamed. `fingerprint` is the node's
 *  module closure mtime (omit / non-number ⇒ stored as `null`, which always
 *  reads back as a miss). The ports object is emitted element-by-element
 *  exactly as before — the envelope adds a fixed-size, constant prefix. */
export async function writePersistedCache(
  filePath: string,
  ports: Record<string, unknown>,
  fingerprint?: number
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const s = createWriteStream(filePath);
    s.on('error', reject);
    s.on('finish', resolve);

    const keys = Object.keys(ports);
    const m = typeof fingerprint === 'number' ? fingerprint : null;
    s.write(`{"__cocoon":1,"mtime":${m},"ports":{`);
    keys.forEach((port, pi) => {
      s.write(JSON.stringify(port) + ':');
      const data = ports[port];
      if (Array.isArray(data)) {
        // Element-by-element: never stringify the whole array at once.
        s.write('[');
        for (let i = 0; i < data.length; i++) {
          s.write(JSON.stringify(data[i]));
          if (i < data.length - 1) s.write(',');
        }
        s.write(']');
      } else {
        s.write(JSON.stringify(data));
      }
      if (pi < keys.length - 1) s.write(',');
    });
    s.end('}}'); // close the ports object, then the envelope
  });
}

/**
 * Cheap head-read of the envelope's `mtime` fingerprint — reads only the
 * leading bytes, never the (possibly multi-hundred-MiB) ports payload. Returns
 * `undefined` for a missing file, a legacy (pre-envelope) cache, or a `null`
 * fingerprint — all of which restore treats as a miss.
 */
export async function readCacheFingerprint(
  filePath: string
): Promise<number | undefined> {
  let head: string;
  try {
    const fh = await open(filePath, 'r');
    try {
      const buf = new Uint8Array(256);
      const { bytesRead } = await fh.read(buf, 0, 256, 0);
      head = new TextDecoder().decode(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  } catch {
    return undefined; // missing / unreadable
  }
  if (!/"__cocoon"\s*:/.test(head)) return undefined; // legacy, no envelope
  const m = /"mtime"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(head);
  if (!m) return undefined; // null fingerprint or malformed
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Forward-only character source over a file read stream. `StringDecoder`
 * keeps multi-byte UTF-8 sequences whole across chunk boundaries. The
 * internal buffer is compacted (consumed prefix dropped) on every refill,
 * so it stays ~one chunk + the current token, never the whole file.
 */
class CharSource {
  private buf = '';
  private pos = 0;
  private ended = false;
  private bytes = 0;
  private readonly decoder = new StringDecoder('utf8');
  private readonly stream: NodeJS.ReadableStream & { destroy(): void };
  private readonly it: AsyncIterator<Buffer>;
  private readonly onBytes?: (total: number) => void;

  constructor(
    stream: NodeJS.ReadableStream & { destroy(): void },
    onBytes?: (total: number) => void
  ) {
    this.stream = stream;
    this.it = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    this.onBytes = onBytes;
  }

  /** Pull one more chunk, compacting the consumed prefix first. */
  private async pull(): Promise<boolean> {
    if (this.pos > 0) {
      this.buf = this.buf.slice(this.pos);
      this.pos = 0;
    }
    if (this.ended) return false;
    const { value, done } = await this.it.next();
    if (done) {
      this.ended = true;
      this.buf += this.decoder.end();
      return this.buf.length > this.pos;
    }
    this.bytes += (value as Buffer).length;
    this.onBytes?.(this.bytes);
    this.buf += this.decoder.write(value as Buffer);
    return true;
  }

  /** Ensure ≥1 char is available; return it without consuming, '' at EOF. */
  async peek(): Promise<string> {
    while (this.pos >= this.buf.length) {
      if (!(await this.pull())) return '';
    }
    return this.buf[this.pos];
  }

  /** Consume and return one char (throws at EOF). */
  async take(): Promise<string> {
    const c = await this.peek();
    if (c === '') throw new Error('unexpected end of cache JSON');
    this.pos++;
    return c;
  }

  /** Consume exactly `n` chars (used for `\uXXXX` escapes). */
  async takeN(n: number): Promise<string> {
    let out = '';
    for (let i = 0; i < n; i++) out += await this.take();
    return out;
  }

  async skipWhitespace(): Promise<void> {
    for (;;) {
      const c = await this.peek();
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') this.pos++;
      else return;
    }
  }

  /**
   * Read a JSON string. The unescaped run between escapes is sliced from
   * the buffer synchronously — that's the bulk of the bytes — so per-char
   * `await` only happens on the rare escape or chunk boundary.
   */
  async readString(): Promise<string> {
    this.pos++; // consume opening "
    let out = '';
    for (;;) {
      let j = this.pos;
      const b = this.buf;
      while (j < b.length) {
        const code = b.charCodeAt(j);
        if (code === 34 /* " */ || code === 92 /* \ */) break;
        j++;
      }
      out += b.slice(this.pos, j);
      this.pos = j;
      if (j >= b.length) {
        if (!(await this.pull())) throw new Error('unterminated string');
        continue;
      }
      if (this.buf[this.pos] === '"') {
        this.pos++;
        return out;
      }
      this.pos++; // consume backslash
      const e = await this.take();
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u':
          out += String.fromCharCode(parseInt(await this.takeN(4), 16));
          break;
        default:
          throw new Error(`invalid escape \\${e} in cache JSON`);
      }
    }
  }

  destroy(): void {
    this.stream.destroy();
  }
}

const NUMBER_CHARS = new Set('-+.0123456789eE');

async function parseValue(src: CharSource): Promise<unknown> {
  await src.skipWhitespace();
  const c = await src.peek();
  switch (c) {
    case '':
      throw new Error('unexpected end of cache JSON');
    case '{':
      return parseObject(src);
    case '[':
      return parseArray(src);
    case '"':
      return src.readString();
    case 't':
      await expectWord(src, 'true');
      return true;
    case 'f':
      await expectWord(src, 'false');
      return false;
    case 'n':
      await expectWord(src, 'null');
      return null;
    default:
      return parseNumber(src);
  }
}

async function expectWord(src: CharSource, word: string): Promise<void> {
  for (const ch of word) {
    if ((await src.take()) !== ch) {
      throw new Error(`expected "${word}" in cache JSON`);
    }
  }
}

async function parseNumber(src: CharSource): Promise<number> {
  let s = '';
  for (;;) {
    const c = await src.peek();
    if (c !== '' && NUMBER_CHARS.has(c)) {
      s += await src.take();
    } else break;
  }
  if (s === '') throw new Error('invalid number in cache JSON');
  return Number(s);
}

/** Object: recursion depth tracks JSON nesting (shallow), not array length
 *  — arrays iterate below — so a million-row import doesn't blow the stack. */
async function parseObject(
  src: CharSource
): Promise<Record<string, unknown>> {
  await src.take(); // consume {
  const obj: Record<string, unknown> = {};
  await src.skipWhitespace();
  if ((await src.peek()) === '}') {
    await src.take();
    return obj;
  }
  for (;;) {
    await src.skipWhitespace();
    if ((await src.peek()) !== '"') {
      throw new Error('expected object key in cache JSON');
    }
    const key = await src.readString();
    await src.skipWhitespace();
    if ((await src.take()) !== ':') {
      throw new Error('expected ":" in cache JSON');
    }
    obj[key] = await parseValue(src);
    await src.skipWhitespace();
    const sep = await src.take();
    if (sep === ',') continue;
    if (sep === '}') return obj;
    throw new Error('expected "," or "}" in cache JSON');
  }
}

/** Array: iterate element-by-element so a long array never recurses. */
async function parseArray(src: CharSource): Promise<unknown[]> {
  await src.take(); // consume [
  const arr: unknown[] = [];
  await src.skipWhitespace();
  if ((await src.peek()) === ']') {
    await src.take();
    return arr;
  }
  for (;;) {
    arr.push(await parseValue(src));
    await src.skipWhitespace();
    const sep = await src.take();
    if (sep === ',') continue;
    if (sep === ']') return arr;
    throw new Error('expected "," or "]" in cache JSON');
  }
}

/**
 * Read a cache written by `writePersistedCache` back into a port map,
 * without ever holding the file as one string. Rejects on missing/invalid
 * file — callers treat that as a miss and recompute.
 *
 * `onBytes` reports the running total of decoded bytes as chunks stream
 * in — the runtime turns it into a live progress line on the hydrating node.
 */
export async function readPersistedCache(
  filePath: string,
  onBytes?: (total: number) => void
): Promise<Record<string, unknown>> {
  const stream = createReadStream(filePath);
  const src = new CharSource(stream, onBytes);
  try {
    const value = await parseValue(src);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('cache root is not a port object');
    }
    const root = value as Record<string, unknown>;
    // Envelope form: unwrap to the ports object. (Legacy unwrapped caches are
    // returned as-is — but restore's fingerprint guard treats them as a miss,
    // so this branch is reached only via direct callers, never normal restore.)
    if (typeof root.__cocoon === 'number') {
      const ports = root.ports;
      if (ports === null || typeof ports !== 'object' || Array.isArray(ports)) {
        throw new Error('cache envelope missing ports object');
      }
      return ports as Record<string, unknown>;
    }
    return root;
  } finally {
    src.destroy();
  }
}
