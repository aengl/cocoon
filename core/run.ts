/**
 * Headless frontend: process a target port and stream it to stdout.
 *
 *   cocoon run <file> --target cocoon://Node/out/port [--format json|table]
 */
import { Runtime } from './runtime.ts';

type Format = 'json' | 'table';

function table(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) return formatJson(data);
  const rows = data.slice(0, 50) as Record<string, unknown>[];
  const cols = [...new Set(rows.flatMap(r => Object.keys(r ?? {})))].slice(
    0,
    8
  );
  const cell = (v: unknown) => {
    const s =
      v == null
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
    return s.length > 24 ? s.slice(0, 23) + '…' : s;
  };
  const widths = cols.map(c =>
    Math.max(c.length, ...rows.map(r => cell(r?.[c]).length))
  );
  const line = (cells: string[]) =>
    cells.map((s, i) => s.padEnd(widths[i])).join('  ');
  const out = [
    line(cols),
    widths.map(w => '─'.repeat(w)).join('  '),
    ...rows.map(r => line(cols.map(c => cell(r?.[c])))),
  ];
  if (data.length > rows.length) out.push(`… (${data.length} rows total)`);
  return out.join('\n');
}

const formatJson = (data: unknown) => JSON.stringify(data, null, 2);

export async function run(
  filePath: string,
  target: string,
  format: Format = 'json',
  opts: { rerunStale?: boolean } = {}
) {
  const rt = await Runtime.load(filePath);
  const parsed = target.match(
    /cocoon:\/\/(?<id>[^/]+)\/(?<inout>[^/]+)\/(?<port>.+)/
  );
  if (!parsed?.groups) {
    console.error(`Invalid --target: ${target}`);
    process.exit(2);
  }
  const { id } = parsed.groups;
  await rt.process(id, { rerunStale: opts.rerunStale === true });
  const data = rt.readPort(target);
  process.stdout.write(
    (format === 'table' ? table(data) : formatJson(data)) + '\n'
  );
}
