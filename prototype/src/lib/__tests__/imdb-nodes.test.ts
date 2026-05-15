/**
 * The imdb example's node types — Download, Run, ReadCSV — proven end to end
 * through Runtime on the *exact* graph shape of `examples/imdb/cocoon.yml`
 * (Download → Run `gzip -df` → ReadCSV), but against a local server with tiny
 * fixtures instead of the real multi-GB IMDB datasets. Plus direct
 * ReadCSV parser-correctness cases (quoting / CSV-vs-TSV / filter), since the
 * CSV parser is hand-rolled and zero-dep.
 */
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadCSV } from '../../../core/nodes/ReadCSV.ts';
import { Runtime } from '../../../core/runtime.ts';

const BASICS =
  'tconst\ttitleType\tprimaryTitle\n' +
  'tt1\tmovie\tThe One\n' +
  'tt2\tshort\tA Short\n' +
  'tt3\tmovie\tThe Other\n';
const RATINGS =
  'tconst\taverageRating\tnumVotes\ntt1\t8.1\t1000\ntt3\t6.4\t42\n';

describe('imdb example pipeline (Download → Run gzip → ReadCSV)', () => {
  let server: Server;
  let port: number;
  let dir: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const body =
        req.url === '/basics.tsv.gz'
          ? gzipSync(BASICS)
          : req.url === '/ratings.tsv.gz'
            ? gzipSync(RATINGS)
            : null;
      if (!body) {
        res.statusCode = 404;
        return res.end();
      }
      res.end(body);
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;

    dir = mkdtempSync(path.join(tmpdir(), 'cocoon-imdb-'));
    // Same structure as examples/imdb/cocoon.yml: Download→Run via the
    // `paths` edge; the ReadCSV nodes are deliberately *not* edge-connected
    // (legacy-faithful — they read files the chain wrote to disk), so the
    // chain must be run first, exactly as the real example is driven.
    writeFileSync(
      path.join(dir, 'cocoon.yml'),
      `nodes:
  DownloadData:
    in:
      data:
        - 'http://127.0.0.1:${port}/basics.tsv.gz'
        - 'http://127.0.0.1:${port}/ratings.tsv.gz'
      target: data
    type: Download
  ExtractArchives:
    in:
      command: 'x => \`gzip -df \${x}\`'
      data: 'cocoon://DownloadData/out/paths'
    type: Run
  ReadBasics:
    in:
      filter: |
        x => x.titleType === 'movie'
      tabs: true
      uri: data/basics.tsv
    type: ReadCSV
  ReadRatings:
    in:
      tabs: true
      uri: data/ratings.tsv
    type: ReadCSV
`
    );
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloads, gunzips, then reads the extracted TSVs', async () => {
    const rt = await Runtime.load(path.join(dir, 'cocoon.yml'));

    // Run the download/extract chain (ReadCSV nodes are disconnected, so
    // they don't pull it — same as the real example).
    await rt.process('ExtractArchives');
    expect(rt.readPort('cocoon://DownloadData/out/paths')).toEqual([
      path.join(dir, 'data', 'basics.tsv.gz'),
      path.join(dir, 'data', 'ratings.tsv.gz'),
    ]);
    expect(new Map(rt.snapshot()).get('ExtractArchives')!.status).toBe('done');

    // Now the readers find data/basics.tsv & data/ratings.tsv on disk.
    await rt.process('ReadBasics');
    await rt.process('ReadRatings');

    const basics = rt.readPort('cocoon://ReadBasics/out/data') as Record<
      string,
      string
    >[];
    expect(basics.map(x => x.primaryTitle)).toEqual(['The One', 'The Other']);

    const ratings = rt.readPort('cocoon://ReadRatings/out/data') as Record<
      string,
      string
    >[];
    expect(ratings).toEqual([
      { tconst: 'tt1', averageRating: '8.1', numVotes: '1000' },
      { tconst: 'tt3', averageRating: '6.4', numVotes: '42' },
    ]);
  });
});

describe('ReadCSV parser correctness', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cocoon-csv-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = async (file: string, ports: Record<string, unknown>) => {
    let written: Record<string, unknown> = {};
    const ctx = {
      cocoonFilePath: path.join(dir, 'cocoon.yml'),
      nodeId: 'N',
      debug: () => {},
      ports: {
        read: () => ports,
        write: (d: Record<string, unknown>) => (written = d),
      },
    };
    for await (const _ of ReadCSV.process(ctx as never));
    return written.data as Record<string, string>[];
  };

  it('handles quotes, escaped quotes, embedded separators/newlines, CRLF', async () => {
    writeFileSync(
      path.join(dir, 'q.csv'),
      'name,note\r\n' +
        '"Doe, Jane","line1\nline2"\r\n' +
        '"She said ""hi""",plain\r\n'
    );
    const data = await run('q.csv', { uri: path.join(dir, 'q.csv') });
    expect(data).toEqual([
      { name: 'Doe, Jane', note: 'line1\nline2' },
      { name: 'She said "hi"', note: 'plain' },
    ]);
  });

  it('auto-detects tabs from a .tsv extension and applies a filter list', async () => {
    writeFileSync(path.join(dir, 'd.tsv'), 'a\tb\n1\tx\n2\ty\n3\tx\n');
    const data = await run('d.tsv', {
      uri: path.join(dir, 'd.tsv'),
      filter: "x => x.b === 'x'",
    });
    expect(data).toEqual([
      { a: '1', b: 'x' },
      { a: '3', b: 'x' },
    ]);
  });
});
