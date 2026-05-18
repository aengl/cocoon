import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { castArray, castFunction } from '../cast-function.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Port of legacy `@cocoon/plugin-spreadsheets` ReadCSV. Behaviourally faithful
 * (first row = headers; rows → objects keyed by header; `filter` list applied
 * row-by-row; `tabs` auto-detected from a `.tsv` extension when unset) while
 * shedding all three legacy npm deps the way the rest of the core does:
 * `got` → Node 25 global `fetch`; `csv-parser` → the small zero-dep streaming
 * state machine below (RFC-4180 quoting/escapes/embedded newlines); `lodash`
 * `castArray` → the shared one. Local paths resolve against the cocoon file's
 * directory (like `ReadJSON`), not cwd.
 */

type FilterFn = (...args: unknown[]) => boolean;

/**
 * Stream a delimited file into records. A field is quoted iff it opens with
 * `"`; inside a quoted field `""` is a literal quote; `\r` is stripped, `\n`
 * ends a record. Yields `string[]` rows so the header row can be split off.
 */
async function* parseRows(
  chunks: AsyncIterable<string | Buffer>,
  sep: string
): AsyncGenerator<string[]> {
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let quoteJustClosed = false;
  let sawAny = false;

  for await (const chunk of chunks) {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          inQuotes = false;
          quoteJustClosed = true;
        } else {
          field += c;
        }
        continue;
      }
      if (quoteJustClosed) {
        quoteJustClosed = false;
        if (c === '"') {
          field += '"';
          inQuotes = true;
          sawAny = true;
          continue;
        }
        // otherwise fall through and handle `c` normally
      }
      if (c === '"') {
        inQuotes = true;
        sawAny = true;
      } else if (c === sep) {
        row.push(field);
        field = '';
        sawAny = true;
      } else if (c === '\r') {
        // ignore; CRLF handled by the following \n
      } else if (c === '\n') {
        row.push(field);
        field = '';
        yield row;
        row = [];
        sawAny = false;
      } else {
        field += c;
        sawAny = true;
      }
    }
  }
  if (sawAny || field.length || row.length) {
    row.push(field);
    yield row;
  }
}

export const ReadCSV: CocoonProcessNode = {
  category: 'I/O',
  description: 'Imports data from a CSV file.',

  async *process(ctx) {
    const { filter, tabs, uri } = ctx.ports.read() as {
      filter?: unknown;
      tabs?: boolean;
      uri: string;
    };
    const useTabs = tabs === undefined ? uri.endsWith('.tsv') : tabs;
    const sep = useTabs ? '\t' : ',';
    const filters = castArray(filter ?? []).map(f => castFunction<FilterFn>(f));

    let source: AsyncIterable<string | Buffer>;
    if (/^[a-z]+:\/\//.test(uri) && !uri.startsWith('file://')) {
      yield `Requesting ${uri}`;
      const res = await fetch(uri);
      if (!res.ok || !res.body)
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      source = Readable.fromWeb(
        res.body as Parameters<typeof Readable.fromWeb>[0]
      );
    } else {
      const p = uri.startsWith('file://') ? new URL(uri).pathname : uri;
      const abs = ctx.resolvePath(p);
      source = createReadStream(abs, 'utf8');
    }

    let headers: string[] | undefined;
    const data: Record<string, string>[] = [];
    for await (const row of parseRows(source, sep)) {
      if (!headers) {
        headers = row;
        continue;
      }
      const item: Record<string, string> = {};
      headers.forEach((h, idx) => {
        item[h] = row[idx] ?? '';
      });
      if (filters.every(f => Boolean(f && f(item)))) data.push(item);
    }

    ctx.ports.write({ data });
    return data.length ? `Imported ${data.length} items` : `Imported "${uri}"`;
  },
};
