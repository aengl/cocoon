#!/usr/bin/env node
/**
 * `cocoon` CLI — the single entry point over the standalone core library.
 *
 *   cocoon serve  <file> [--port 22242]
 *   cocoon run    <file> --target cocoon://Node/out/port [--format json|table]
 *   cocoon query  [--core ws://localhost:22242] <overview|node|upstream|
 *                 downstream|peek> [args]
 *   cocoon set-control [--core …] <id> <key> <value>
 *   cocoon reload [--core ws://localhost:22242]
 *
 * `serve`/`run` own their own Runtime (`run` is headless: process a port to
 * stdout, no server). `query`/`set-control`/`reload` are the opposite — a
 * thin client to a *running* `serve`, so they see its live session state.
 * Run with Node directly (types stripped at runtime, no build step).
 */
import { register } from 'node:module';
// Symmetric twin of the esbuild `httpLoader` in core/control-hook-bundle.ts:
// makes `await import('https://…')` inside a node's process()/control.*
// work on the Node side (Node 24 dropped --experimental-network-imports).
// Registered once, before any keystone-6 resolved node module is imported,
// so every later dynamic-import sees the loader. Disk-cached.
register('./http-import-loader.mjs', import.meta.url);

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Callout, ChangeSet, Query } from '../src/lib/protocol.ts';
import {
  callout,
  clearCallout,
  CoreUnreachable,
  readPresence,
  sendProcess,
  sendQuery,
  sendReload,
  sendSetControl,
  suggest,
} from './query-client.ts';
import { run } from './run.ts';
import { serve } from './serve.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];

const usage = `Usage:
  cocoon serve  <file> [--port 22242]
  cocoon run    <file> --target cocoon://Node/out/port [--format json|table]
  cocoon query  [--core ws://localhost:22242] <query> [args]
  cocoon set-control [--core …] <id> <key> <value>
  cocoon process [--core …] <node>
  cocoon reload [--core ws://localhost:22242]
  cocoon presence [--core …]
  cocoon suggest  [--core …] <node> <field> <value>
                  [--json '<changeSet|edits>'] [--label NAME] [--note TEXT]
                  [--timeout MS]
  cocoon callout  [--core …] <node> <message>
                  [--id ID] [--tone info|warn|error] [--from NAME]
  cocoon callout-clear [--core …] <id-or-label>
  cocoon install-skill [--dest ~/.claude/skills/cocoon]
  cocoon install-cli   [--dest ~/.local/bin/cocoon]

Queries:
  overview
  node       <id>
  upstream   <id> [--depth N]
  downstream <id> [--depth N]
  peek       <cocoon://id/out/port> [--descend F] [--where 'x => …']
             [--select a,b,c] [--limit N] [--expand F[,F2,…]]

set-control:
  <id> <key> <value> — steer one declared control. <value> is JSON-parsed
  (true/false/6/"q"), falling back to a raw string. The node is read back so
  the new effective controlState is printed; re-process the node to apply it.

process:
  Run a node on the *running* core (the editor's live session — not a fresh
  headless Runtime like 'cocoon run'). Processes the node + its transitive
  upstream and blocks until the target reaches done/error; prints its final
  status + summary. Then: cocoon query peek cocoon://<node>/out/<port>.

presence:
  Print the live presence snapshot — every other connected client's opaque
  blob (label, viewport, openControls, controlDrafts, …). This is how the
  agent sees "which control the human has open" and "what's pasted in it".

suggest:
  Announce a change-set as the agent's own presence and BLOCK until the human
  Applies/Discards it (the suggestion model — surfaced as one editor toast).
  The single-edit form is positional; --json takes a full ChangeSet or a bare
  edits array. Prints the verdict (applied|discarded|stale) and exits.

callout:
  Mark a node in the editor with a free-text pointer ("look at this — still has
  a view: key"). Fire-and-forget: announces via presence, waits briefly for the
  editor to echo back a chat-friendly short label (C1, C2, …), then exits — the
  marker persists in the editor (the editor snapshots callouts; they outlive
  this process). The user dismisses it with ✕ in the node's popover; their
  reply belongs in chat, not the editor. Re-announcing the same --id updates
  the message and resurrects a dismissed callout.

callout-clear:
  Dismiss a callout from the agent side — symmetric twin of the human's ✕ in
  the editor. Use after the work the callout flagged has been done. Accepts
  either the chat-friendly short label (C1, C2, …; resolved against the
  editor's calloutLabels) or the opaque internal id (co-…). Re-announcing
  the same id later still resurrects.

install-skill:
  Copy this repo's .claude/skills/cocoon into the user's Claude skills dir
  (default ~/.claude/skills/cocoon) so the agent skill is available outside
  the repo. Overwrites any existing copy at the destination.

install-cli:
  Symlink core/cli.ts into a writable PATH dir (default ~/.local/bin/cocoon)
  so \`cocoon …\` works from anywhere. The symlink points back at this
  checkout, so \`git pull\` updates the global command. Replaces any existing
  symlink at the destination. If --dest is omitted and ~/.local/bin isn't on
  your PATH, the command prints a one-line hint.`;

/** Pull `--name value` out of args, returning [value, remaining]. */
function takeFlag(args: string[], name: string): [string | undefined, string[]] {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return [undefined, args];
  return [args[i + 1], [...args.slice(0, i), ...args.slice(i + 2)]];
}

// --- client commands: a mouth for a running core ------------------------
if (
  cmd === 'query' ||
  cmd === 'reload' ||
  cmd === 'set-control' ||
  cmd === 'process' ||
  cmd === 'presence' ||
  cmd === 'suggest' ||
  cmd === 'callout' ||
  cmd === 'callout-clear'
) {
  let rest = argv.slice(1);
  let core: string | undefined;
  [core, rest] = takeFlag(rest, 'core');
  core ??= process.env.COCOON_CORE ?? 'ws://localhost:22242';

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
    } else if (cmd === 'process') {
      const node = rest[0];
      if (!node) {
        console.error(`process requires <node>\n\n${usage}`);
        process.exit(1);
      }
      const r = await sendProcess(core, node);
      console.error(
        `${node}: ${r.status}${r.summary ? ` — ${r.summary}` : ''}${
          r.error ? ` — ${r.error}` : ''
        }`
      );
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      if (r.status === 'error') process.exit(1);
    } else if (cmd === 'presence') {
      const clients = await readPresence(core);
      process.stdout.write(JSON.stringify(clients, null, 2) + '\n');
      console.error(`${clients.length} peer(s) present`);
    } else if (cmd === 'suggest') {
      let pr = rest;
      let json: string | undefined;
      let label: string | undefined;
      let note: string | undefined;
      let timeout: string | undefined;
      [json, pr] = takeFlag(pr, 'json');
      [label, pr] = takeFlag(pr, 'label');
      [note, pr] = takeFlag(pr, 'note');
      [timeout, pr] = takeFlag(pr, 'timeout');

      // Build the change-set: --json (full ChangeSet or a bare edits array)
      // OR the positional single-edit form `<node> <field> <value>`.
      let cs: ChangeSet;
      const id = `sug-${Date.now().toString(36)}`;
      if (json !== undefined) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (err) {
          console.error(`--json is not valid JSON: ${(err as Error).message}`);
          process.exit(1);
        }
        const obj = Array.isArray(parsed) ? { edits: parsed } : (parsed as ChangeSet);
        cs = {
          id: obj.id ?? id,
          ...(label || obj.from ? { from: label ?? obj.from } : {}),
          ...(note || obj.note ? { note: note ?? obj.note } : {}),
          edits: obj.edits ?? [],
        };
      } else {
        const [node, field, ...vparts] = pr;
        const value = vparts.join(' ');
        if (!node || !field || value === '') {
          console.error(
            `suggest requires <node> <field> <value> (or --json)\n\n${usage}`
          );
          process.exit(1);
        }
        cs = {
          id,
          from: label ?? 'claude',
          ...(note ? { note } : {}),
          edits: [{ node, field, value }],
        };
      }
      if (!cs.edits.length) {
        console.error('suggest: change-set has no edits');
        process.exit(1);
      }

      console.error(
        `suggesting ${cs.edits.length} edit(s) [${cs.id}] — waiting for the human to Apply/Discard…`
      );
      const r = await suggest(
        core,
        cs,
        label ?? cs.from ?? 'claude',
        timeout ? Number(timeout) : undefined
      );
      console.error(`changeset ${cs.id}: ${r.verdict} by ${r.by}`);
      process.stdout.write(
        JSON.stringify({ id: cs.id, verdict: r.verdict, by: r.by }, null, 2) +
          '\n'
      );
    } else if (cmd === 'callout') {
      let pr = rest;
      let idFlag: string | undefined;
      let toneFlag: string | undefined;
      let fromFlag: string | undefined;
      let timeoutFlag: string | undefined;
      [idFlag, pr] = takeFlag(pr, 'id');
      [toneFlag, pr] = takeFlag(pr, 'tone');
      [fromFlag, pr] = takeFlag(pr, 'from');
      [timeoutFlag, pr] = takeFlag(pr, 'timeout');

      const [node, ...mparts] = pr;
      const message = mparts.join(' ');
      if (!node || message === '') {
        console.error(`callout requires <node> <message>\n\n${usage}`);
        process.exit(1);
      }
      if (toneFlag && !['info', 'warn', 'error'].includes(toneFlag)) {
        console.error(
          `--tone must be one of info|warn|error (got ${toneFlag})`
        );
        process.exit(1);
      }
      // Auto-generate an internal id when --id is omitted. Base36 timestamp
      // is unique-enough for the per-session use; agents can pass --id when
      // they want to re-announce/update an existing callout.
      const internalId = idFlag ?? `co-${Date.now().toString(36)}`;
      const c: Callout = {
        id: internalId,
        node,
        message,
        ts: Date.now(),
        ...(toneFlag ? { tone: toneFlag as 'info' | 'warn' | 'error' } : {}),
        ...(fromFlag ? { from: fromFlag } : {}),
      };
      const r = await callout(
        core,
        c,
        fromFlag ?? 'claude',
        timeoutFlag ? Number(timeoutFlag) : undefined
      );
      // The label echo is the human-visible name in chat — print it loud on
      // stderr and as a JSON line on stdout so a script can capture both.
      if (r.label) console.error(`announced ${r.label} on ${node}`);
      else
        console.error(
          `announced (no editor connected — label will be assigned once one is)`
        );
      process.stdout.write(
        JSON.stringify({ id: internalId, label: r.label ?? null }, null, 2) +
          '\n'
      );
    } else if (cmd === 'callout-clear') {
      const arg = rest[0];
      if (!arg) {
        console.error(`callout-clear requires <id-or-label>\n\n${usage}`);
        process.exit(1);
      }
      const r = await clearCallout(core, arg);
      console.error(
        r.acked
          ? `cleared ${arg} (editor acked)`
          : `cleared ${arg} (no editor ack — fire-and-forget)`
      );
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
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
        let descend, where, select, limit, expand;
        [descend, pr] = takeFlag(pr, 'descend');
        [where, pr] = takeFlag(pr, 'where');
        [select, pr] = takeFlag(pr, 'select');
        [limit, pr] = takeFlag(pr, 'limit');
        [expand, pr] = takeFlag(pr, 'expand');
        q = {
          kind: 'peek',
          uri,
          ...(descend ? { descend } : {}),
          ...(where ? { where } : {}),
          ...(select ? { select: select.split(',') } : {}),
          ...(limit ? { limit: Number(limit) } : {}),
          ...(expand ? { expand: expand.split(',') } : {}),
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
// --- local-fs command: copy the bundled agent skill into ~/.claude -----
else if (cmd === 'install-skill') {
  let rest = argv.slice(1);
  let dest: string | undefined;
  [dest, rest] = takeFlag(rest, 'dest');

  // Source lives at <repo>/.claude/skills/cocoon — one dir up from this file
  // (core/cli.ts → repo). Resolve via import.meta.url so it works regardless
  // of cwd.
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, '..', '.claude', 'skills', 'cocoon');
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    console.error(`install-skill: skill source not found at ${src}`);
    process.exit(1);
  }

  const target = dest ?? join(homedir(), '.claude', 'skills', 'cocoon');
  mkdirSync(dirname(target), { recursive: true });
  // Overwrite unconditionally — the destination is a derivative of the repo
  // source; force on cpSync replaces files in place.
  cpSync(src, target, { recursive: true, force: true });
  console.error(`installed cocoon skill → ${target}`);
}
// --- local-fs command: symlink this cli.ts into a writable PATH dir -----
else if (cmd === 'install-cli') {
  let rest = argv.slice(1);
  let dest: string | undefined;
  [dest, rest] = takeFlag(rest, 'dest');

  // Resolve to the real on-disk path of cli.ts (not a /tmp eval path) so
  // the symlink survives `git pull` — it points at the file in this repo.
  const here = dirname(fileURLToPath(import.meta.url));
  const src = realpathSync(join(here, 'cli.ts'));

  const defaultDest = join(homedir(), '.local', 'bin', 'cocoon');
  const target = dest ? dest.replace(/^~(?=\/|$)/, homedir()) : defaultDest;
  mkdirSync(dirname(target), { recursive: true });
  // Replace an existing symlink/file at the destination — symlinkSync errors
  // if the path exists, and we promised to overwrite.
  try {
    lstatSync(target);
    unlinkSync(target);
  } catch {
    // not there — fine
  }
  symlinkSync(src, target);
  console.error(`installed cocoon cli → ${target} → ${src}`);

  if (!dest) {
    const path = process.env.PATH ?? '';
    const binDir = dirname(target);
    const onPath = path.split(':').some(p => p === binDir);
    if (!onPath) {
      console.error(
        `note: ${binDir} is not on your PATH — add it (e.g. \`export PATH="${binDir}:$PATH"\` in your shell rc) or pass --dest to a dir that is.`,
      );
    }
  }
}
// --- file commands: own their own Runtime -------------------------------
else if (cmd === 'serve' || cmd === 'run') {
  let file = argv[1];
  if (!file) {
    console.error(usage);
    process.exit(1);
  }
  // Accept a flow dir as a shorthand for its `cocoon.yml` / `index.yml`.
  if (existsSync(file) && statSync(file).isDirectory()) {
    const found = ['cocoon.yml', 'index.yml']
      .map(n => join(file, n))
      .find(p => existsSync(p));
    if (!found) {
      console.error(`${file}: no cocoon.yml or index.yml`);
      process.exit(1);
    }
    file = found;
  }
  const flag = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  if (cmd === 'serve') {
    await serve(file, Number(flag('port', '22242')));
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
