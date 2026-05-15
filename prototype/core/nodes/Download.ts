import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { castArray, castFunction } from '../cast-function.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Port of legacy `@cocoon/cocoon` Download (`nodes/io/Download.ts`), kept
 * behaviourally faithful while shedding its three npm deps the way the rest of
 * the prototype core does: `got.stream`+`stream.pipeline` → Node 25 global
 * `fetch` piped to disk; `lodash` (`identity`/`castArray`/`isString`/`set`/
 * `get`/`concat`) → tiny local equivalents + the shared `castArray`;
 * `resolveFilePath` (cwd-relative) → resolved against the cocoon file's
 * directory, exactly as `ReadJSON` does, so the graph runs regardless of cwd.
 */

const isString = (v: unknown): v is string => typeof v === 'string';

/** Resolve a (possibly `~`/relative) path against the cocoon file's dir. */
function resolveLocal(p: string, cocoonFilePath: string) {
  const expanded =
    p[0] === '~' ? path.join(process.env.HOME ?? '', p.slice(1)) : p;
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(cocoonFilePath), expanded);
}

/** Minimal lodash `_.get`/`_.set` over dotted paths; no-op on non-objects. */
function lget(obj: unknown, prop: string, fallback: unknown) {
  let cur: unknown = obj;
  for (const k of prop.split('.')) {
    if (cur == null || typeof cur !== 'object') return fallback;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur === undefined ? fallback : cur;
}

function lset(obj: unknown, prop: string, value: unknown) {
  if (obj == null || typeof obj !== 'object') return; // lodash leaves primitives untouched
  const keys = prop.split('.');
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

interface Source {
  name?: string;
  url: string;
}

async function download(
  url: string,
  target: string,
  options?: { headers?: Record<string, string>; method?: string }
) {
  const res = await fetch(url, options as RequestInit | undefined);
  if (!res.ok || !res.body)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(target)
  );
}

export const Download: CocoonProcessNode = {
  category: 'I/O',
  description: 'Downloads files.',

  async *process(ctx) {
    const ports = ctx.ports.read() as {
      attribute?: string;
      batchSize?: number;
      clean?: boolean;
      data: Record<string, unknown>[];
      map?: string | ((item: unknown) => Source | Source[]);
      options?: { headers?: Record<string, string>; method?: string };
      postprocess?: string;
      skip?: boolean;
      target?: string;
    };
    const attribute = ports.attribute ?? 'files';
    const batchSize = ports.batchSize ?? 5;
    const { clean, data, map, options, postprocess, skip } = ports;
    const getImageData = map ? castFunction(map)! : (x: unknown) => x;
    const targetRoot = resolveLocal(ports.target ?? '.', ctx.cocoonFilePath);

    yield ['Creating target directory', 0];
    await fs.mkdir(targetRoot, { recursive: true });

    const sourcesForItem = data
      .map(item => ({ item, source: getImageData(item) }))
      .filter(x => Boolean(x.source));

    yield ['Preparing sources', 0];
    const sources = sourcesForItem.flatMap(x =>
      castArray(x.source)
        .map(y => (isString(y) ? { url: y } : (y as Source)))
        .filter(y => Boolean(y.url))
        .map(y => {
          const extension = path.extname(y.url);
          const fileName = y.name
            ? `${y.name}${extension}`
            : y.url.slice(y.url.lastIndexOf('/') + 1);
          return {
            ...y,
            extension,
            fileName,
            filePath: path.join(targetRoot, fileName),
            item: x.item,
          };
        })
    );

    const multiplePerItem = sourcesForItem.some(x => Array.isArray(x.source));

    let numDownloaded = 0;
    let numSkipped = 0;
    for (let i = 0; i < sources.length; i += batchSize) {
      const batch = sources.slice(i, i + batchSize);
      const downloads = batch.map(async ({ filePath, item, url }) => {
        const exists = await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false);
        if (!skip || !exists) {
          ctx.debug(`downloading "${url}" to "${filePath}"`);
          await download(url, filePath, options);
          numDownloaded += 1;
          if (postprocess) await spawnProcess(postprocess, filePath, ctx);
        } else {
          numSkipped += 1;
        }
        if (multiplePerItem) {
          lset(item, attribute, [
            ...castArray(lget(item, attribute, []) as unknown),
            filePath,
          ]);
        } else {
          lset(item, attribute, filePath);
        }
      });
      yield [
        `${downloads.length} active downloads, ${numDownloaded} completed`,
        numDownloaded / sources.length,
      ];
      await Promise.all(downloads);
    }

    let numRemoved = 0;
    if (clean) {
      yield ['Cleaning target directory', 0.99];
      const keep = new Set(sources.map(x => x.fileName));
      const surplus = (await fs.readdir(targetRoot)).filter(f => !keep.has(f));
      await Promise.all(
        surplus.map(f => fs.unlink(path.join(targetRoot, f)))
      );
      numRemoved = surplus.length;
    }

    ctx.ports.write({ data, paths: sources.map(x => x.filePath) });
    return `Downloaded ${numDownloaded}, removed ${numRemoved} and skipped ${numSkipped} files`;
  },
};

function spawnProcess(
  command: string,
  filePath: string,
  ctx: { cocoonFilePath: string; debug: (...a: unknown[]) => void }
) {
  ctx.debug(`spawning child process "${command}"`, [filePath]);
  const child = spawn(command, [filePath], {
    cwd: path.dirname(ctx.cocoonFilePath),
    shell: true,
    stdio: 'inherit',
  });
  return new Promise<void>((resolve, reject) => {
    child.once('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`process failed with code: ${code}`))
    );
    child.once('error', reject);
  });
}
