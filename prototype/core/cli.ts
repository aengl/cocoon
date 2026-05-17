/**
 * `cocoon` CLI — the single entry point over the standalone core library.
 *
 *   cocoon serve  <file> [--port 4000]
 *   cocoon run    <file> --target cocoon://Node/out/port [--format json|table]
 *   cocoon query  [--core ws://localhost:4000] <overview|node|upstream|
 *                 downstream|peek> [args]
 *   cocoon set-control [--core …] <id> <key> <value>
 *   cocoon reload [--core ws://localhost:4000]
 *
 * `serve`/`run` own their own Runtime (`run` is headless: process a port to
 * stdout, no server). `query`/`set-control`/`reload` are the opposite — a
 * thin client to a *running* `serve`, so they see its live session state.
 * Run with Node directly (types stripped at runtime, no build step).
 */
import type { Query } from '../src/lib/protocol.ts';
import {
  CoreUnreachable,
  sendQuery,
  sendReload,
  sendSetControl,
} from './query-client.ts';
import { run } from './run.ts';
import { serve } from './serve.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];

const usage = `Usage:
  cocoon serve  <file> [--port 4000]
  cocoon run    <file> --target cocoon://Node/out/port [--format json|table]
  cocoon query  [--core ws://localhost:4000] <query> [args]
  cocoon set-control [--core …] <id> <key> <value>
  cocoon reload [--core ws://localhost:4000]

Queries:
  overview
  node       <id>
  upstream   <id> [--depth N]
  downstream <id> [--depth N]
  peek       <cocoon://id/out/port> [--descend F] [--where 'x => …']
             [--select a,b,c] [--limit N]

set-control:
  <id> <key> <value> — steer one declared control. <value> is JSON-parsed
  (true/false/6/"q"), falling back to a raw string. The node is read back so
  the new effective controlState is printed; re-process the node to apply it.`;

/** Pull `--name value` out of args, returning [value, remaining]. */
function takeFlag(args: string[], name: string): [string | undefined, string[]] {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return [undefined, args];
  return [args[i + 1], [...args.slice(0, i), ...args.slice(i + 2)]];
}

// --- client commands: a mouth for a running core ------------------------
if (cmd === 'query' || cmd === 'reload' || cmd === 'set-control') {
  let rest = argv.slice(1);
  let core: string | undefined;
  [core, rest] = takeFlag(rest, 'core');
  core ??= process.env.COCOON_CORE ?? 'ws://localhost:4000';

  try {
    if (cmd === 'set-control') {
      const [id, key, raw] = rest;
      if (!id || !key || raw === undefined) {
        console.error(`set-control requires <id> <key> <value>\n\n${usage}`);
        process.exit(1);
      }
      // JSON-parse so the four control kinds round-trip from one string arg
      // (true/false → toggle, 6 → number, "x"/x → select/text); a bare word
      // that isn't valid JSON is the raw string (e.g. `euclidean`).
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      const d = await sendSetControl(core, id, key, value);
      // Read-back: a documented silent no-op (unknown key, bad value, schema
      // not yet resolved) shows here as controlState NOT reflecting `value`.
      const took =
        d.controlState && d.controlState[key] !== undefined
          ? JSON.stringify(d.controlState[key]) === JSON.stringify(value)
          : false;
      console.error(
        `${id}.${key} := ${JSON.stringify(value)} — ${
          took ? 'set' : 'IGNORED (no-op; resolve/process the node first?)'
        }; node ${d.status}. Re-process ${id} to apply.`
      );
      process.stdout.write(
        JSON.stringify(
          { status: d.status, controlState: d.controlState ?? null },
          null,
          2
        ) + '\n'
      );
    } else if (cmd === 'reload') {
      const r = await sendReload(core);
      const st = Object.entries(r.status)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.error(
        `reloaded ${r.file ?? ''} — ${r.nodes} nodes (${st || 'none'})`
      );
    } else {
      const kind = rest[0];
      const arg = rest[1]; // <id> or <uri>, required by all but `overview`
      const need = (label: string) => {
        if (!arg) {
          console.error(`${kind} requires ${label}\n\n${usage}`);
          process.exit(1);
        }
        return arg;
      };
      let q: Query;
      if (kind === 'overview') {
        q = { kind: 'overview' };
      } else if (kind === 'node') {
        q = { kind: 'node', id: need('<id>') };
      } else if (kind === 'upstream' || kind === 'downstream') {
        const id = need('<id>');
        const [depth] = takeFlag(rest.slice(2), 'depth');
        q = { kind, id, ...(depth ? { depth: Number(depth) } : {}) };
      } else if (kind === 'peek') {
        const uri = need('<cocoon://id/out/port>');
        let pr = rest.slice(2);
        let descend, where, select, limit;
        [descend, pr] = takeFlag(pr, 'descend');
        [where, pr] = takeFlag(pr, 'where');
        [select, pr] = takeFlag(pr, 'select');
        [limit, pr] = takeFlag(pr, 'limit');
        q = {
          kind: 'peek',
          uri,
          ...(descend ? { descend } : {}),
          ...(where ? { where } : {}),
          ...(select ? { select: select.split(',') } : {}),
          ...(limit ? { limit: Number(limit) } : {}),
        };
      } else {
        console.error(usage);
        process.exit(1);
      }
      const data = await sendQuery(core, q);
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(err instanceof CoreUnreachable ? 2 : 1);
  }
}
// --- file commands: own their own Runtime -------------------------------
else if (cmd === 'serve' || cmd === 'run') {
  const file = argv[1];
  if (!file) {
    console.error(usage);
    process.exit(1);
  }
  const flag = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  if (cmd === 'serve') {
    await serve(file, Number(flag('port', '4000')));
  } else {
    const target = flag('target');
    if (!target) {
      console.error('run requires --target cocoon://Node/out/port');
      process.exit(1);
    }
    const format = flag('format', 'json') as 'json' | 'table';
    // Own the headless exit code explicitly. `run` rejects when the *target*
    // node couldn't be produced (the documented "non-zero only if the
    // requested target failed" contract); catching it here keeps that intact
    // independently of node-guard, which otherwise swallows the rejection.
    try {
      await run(file, target, format);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
} else {
  console.error(usage);
  process.exit(1);
}
