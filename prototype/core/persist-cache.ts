/**
 * Streamed persist-cache writer **and reader**.
 *
 * `Runtime` previously wrote a node's cache as
 * `fs.writeFile(path, JSON.stringify(written))` and read it back as
 * `JSON.parse(fs.readFile(path,'utf8'))`. Both allocate the *entire*
 * serialised output as one string, and V8 caps a string at 536,870,888 chars:
 * the `boardgames.yml` `ImportBGGData` node (`SELECT id, document FROM
 * boardgamegeek`, 153k rows / ~542 MiB of JSON) overflows it.
 *
 * The write side was fixed first (a legacy-faithful port of the old
 * `@cocoon/cocoon` `writePersistedCache`, which streamed for exactly this
 * reason): arrays are emitted element-by-element, so no single
 * `JSON.stringify` ever runs on the whole dataset. The bytes produced are
 * **identical** to `JSON.stringify(ports)`.
 *
 * The read side used to be left as `JSON.parse(readFile(..,'utf8'))`, on the
 * theory that a too-large cache would simply throw and Runtime would silently
 * recompute. In practice that meant `ImportBGGData` (and any node whose cache
 * crosses the string limit) was **never restored from cache** — every load
 * re-ran the SQL. `readPersistedCache` closes that gap with the symmetric
 * streamed parse: a chunked, compacting recursive-descent JSON parser that
 * never materialises the file (or any array) as a single string and never
 * hands the whole blob to one `JSON.parse`. The parsed structure it returns
 * is the same one the node held in memory when it was written, so the rest of
 * Runtime is unchanged. Missing/invalid caches still reject (Runtime's
 * existing `catch` recomputes) — behaviour for the small-cache common case is
 * identical to the old `JSON.parse(readFile)`.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/**
 * Write `ports` (port name → value) to `filePath` as a single JSON object,
 * streamed. Byte-for-byte equal to `JSON.stringify(ports)` for JSON data.
 */
export async function writePersistedCache(
  filePath: string,
  ports: Record<string, unknown>
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const s = createWriteStream(filePath);
    s.on('error', reject);
    s.on('finish', resolve);

    const keys = Object.keys(ports);
    s.write('{');
    keys.forEach((port, pi) => {
      s.write(JSON.stringify(port) + ':');
      const data = ports[port];
      if (Array.isArray(data)) {
        // The whole point: never `JSON.stringify` the array as one string.
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
    s.end('}');
  });
}

/**
 * A forward-only character source over a file read stream. Chunks are decoded
 * with a `StringDecoder` so a multi-byte UTF-8 sequence is never split across
 * a chunk boundary. The internal buffer is **compacted** (already-consumed
 * prefix dropped) every refill, so it stays ~one chunk + the current token —
 * never the whole file. The parser is strictly forward-only, so dropping the
 * consumed prefix is safe.
 */
class CharSource {
  private buf = '';
  private pos = 0;
  private ended = false;
  private readonly decoder = new StringDecoder('utf8');
  private readonly stream: NodeJS.ReadableStream & { destroy(): void };
  private readonly it: AsyncIterator<Buffer>;

  constructor(stream: NodeJS.ReadableStream & { destroy(): void }) {
    this.stream = stream;
    this.it = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
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
   * Scan a JSON string (current char is the opening quote). The unescaped run
   * between escapes is sliced out of the buffer synchronously — that run is
   * the bulk of the bytes (e.g. a row's `document`) — so the per-char `await`
   * only happens on the comparatively rare escape / chunk boundary.
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

/**
 * Parse an object. Recursion depth tracks JSON *nesting* (shallow for our
 * `{id, document}` rows), not array length — arrays iterate below — so the
 * 153k-row import doesn't blow the call stack.
 */
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

/** Parse an array element-by-element — the large-cache path. */
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
 * Read a persisted cache file written by `writePersistedCache` back into the
 * port map, without ever holding the file (or any array) as one string.
 * Rejects on a missing/empty/invalid file — Runtime's caller treats that as a
 * cache miss and recomputes, exactly as it did for the old
 * `JSON.parse(readFile)`.
 */
export async function readPersistedCache(
  filePath: string
): Promise<Record<string, unknown>> {
  const stream = createReadStream(filePath);
  const src = new CharSource(stream);
  try {
    const value = await parseValue(src);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('cache root is not a port object');
    }
    return value as Record<string, unknown>;
  } finally {
    src.destroy();
  }
}
