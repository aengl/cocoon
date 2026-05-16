/**
 * Streamed persist-cache writer.
 *
 * `Runtime` previously wrote a node's cache as
 * `fs.writeFile(path, JSON.stringify(written))`. That allocates the *entire*
 * serialised output as one string, and V8 caps a string at 536,870,888 chars:
 * the `boardgames.yml` `ImportBGGData` node (`SELECT id, document FROM
 * boardgamegeek`, 153k rows / ~542 MiB of JSON) overflowed it and the node
 * failed with `RangeError: Invalid string length`.
 *
 * This is the legacy-faithful fix — a port of the old
 * `@cocoon/cocoon` `writePersistedCache` (it streamed, for exactly this
 * reason). Arrays are emitted element-by-element; each element is small, so no
 * single `JSON.stringify` ever runs on the whole dataset. The bytes produced
 * are **identical** to `JSON.stringify(ports)` (same key order, same encoding),
 * so `Runtime`'s existing `JSON.parse(readFile)` reader is unchanged.
 *
 * Read side is deliberately untouched: a cache whose JSON still exceeds the
 * string limit on read makes `readFile(..,'utf8')` throw, which Runtime
 * already catches and silently recomputes — same effective behaviour as
 * legacy. The win here is that the *write* (and therefore the node) no longer
 * fails, so the flow runs end-to-end.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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
