#!/usr/bin/env node
/**
 * `cocoon` CLI. `serve`/`run` own a Runtime; `query`/`set-control`/`reload`/
 * `process`/`presence`/`suggest`/`callout(-clear)` are thin clients to a
 * running `serve` (so they see its live session state).
 */
import { register } from 'node:module';
// Register the http-import loader BEFORE any node module is imported, so
// every dynamic `import('https://…')` inside `process`/`control.*` is
// fetched + cached on disk. (Node 24 dropped --experimental-network-imports.)
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Callout, ChangeSet, Query } from '../src/lib/protocol.ts';
import {
  callout,
  clearCallout,
  CoreUnreachable,
  readPresence,
  sendControlEvent,
  sendProcess,
  sendQuery,
  sendRefreshControl,
  sendReload,
  sendSetControl,
  sendSwitch,
  streamErrors,
  suggest,
} from './query-client.ts';
import { run } from './run.ts';
import { serve } from './serve.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];

const usage = `Usage:
  cocoon serve  <file> [--port 22242]
  cocoon run    <file> --target cocoon://Node/out/port [--format json|table]
                                    [--rerun-stale]
  cocoon query  [--core ws://localhost:22242] <query> [args]
  cocoon set-control [--core …] <id> <key> <value>
  cocoon control-event [--core …] <node> <event> [--json '<payload>']
  cocoon refresh-control [--core …] <node>
  cocoon process [--core …] <node> [--rerun-stale]
  cocoon reload [--core ws://localhost:22242]
  cocoon switch [--core …] <file>   — re-point the running core at another flow
  cocoon presence [--core …]
  cocoon suggest  [--core …] <node> <field> <value>
                  [--json '<changeSet|edits>'] [--label NAME] [--note TEXT]
                  [--timeout MS]
  cocoon callout  [--core …] <node> <message>
                  [--id ID] [--tone info|warn|error] [--from NAME]
  cocoon callout-clear [--core …] <id-or-label>
  cocoon errors        [--core …]
  cocoon install-skill [--dest ~/.claude/skills/cocoon]
  cocoon install-cli   [--dest ~/.local/bin/cocoon]

Queries:
  overview
  node       <id>
  logs       <id> [--limit N]   — the node's buffered ctx.debug() lines
  upstream   <id> [--depth N]
  downstream <id> [--depth N]
  peek       <cocoon://id/out/port> [--descend F] [--where 'x => …']
             [--select a,b,c] [--limit N] [--expand F[,F2,…]]

set-control:
  <id> <key> <value> — steer one declared control. <value> is JSON-parsed
  (true/false/6/"q"), falling back to a raw string. The node is read back so
  the new effective controlState is printed; re-process the node to apply it.

control-event:
  Deliver one free-form control event to a running node — exactly as the
  human clicking in the UI does. The core invokes the node's
  control.event(ctx, { event, payload }) handler, then re-derives control.data
  and re-streams controlData/HTML (the identical post-event path the UI fires).
  <event> is the handler-declared event name; --json is its JSON payload
  (default {}). Whether the graph ages is the HANDLER's decision, unchanged: a
  handler that calls ctx.markStale() (e.g. merge_done) ages the node + its
  downstream; one that doesn't (cell_edit, seed_rows) is pure presentation.
  Pull stays the sole compute trigger — this only delivers the event. No new
  capability: it can fire only events the node already declares and handles.
  Prints the node's resulting status + bounded controlData (same surface as
  'query node'). No-op on a node with no matching control event handler.
  ('refresh-control <node>' is the named sugar for the reserved '$mount'
  refresh event; prefer it for a plain view re-derive.)

refresh-control:
  Re-derive a node's free-form control out of band — re-runs control.data,
  re-renders, and re-streams controlData/HTML to every connected client
  WITHOUT a pull: no process(), no graph aging, no status change. This is the
  cheap refresh to fire after you write the node's OWN durable file directly
  (e.g. an annotation JSONL the human watches fill in real time) so the live
  control reflects your write without a re-fold. Prints the node's resulting
  status + the bounded controlData (same surface as 'query node'). No-op on a
  node with no free-form control. Pull stays the sole compute trigger.

process:
  Run a node on the *running* core (the editor's live session — not a fresh
  headless Runtime like 'cocoon run'). Processes the node + its transitive
  upstream and blocks until the target reaches done/stale/error; prints its
  final status + summary. Then: cocoon query peek cocoon://<node>/out/<port>.

  Stale upstream is *reused* by default (the cheap-iteration path): a stale
  node's kept-amber output is fed downstream and the target finishes 'stale'
  itself, honestly flagging the result as derived-from-stale. Pass
  --rerun-stale to force every stale upstream to recompute from scratch
  before the target runs (the toolbar's shift-click twin).

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

errors:
  Subscribe to the live core's per-node error stream over WS and print one
  batched line group per fresh failure: \`node "<id>" failed\` followed by the
  stack (or the bare error message if none). The connect-burst snapshot is
  treated as baseline — only transitions INTO error state from then on fire.
  Long-lived: runs until the core disconnects, exit 0. Designed for a
  Monitor: \`Monitor("cocoon errors")\` gives an agent proactive node-failure
  notifications regardless of who launched the core.

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

// --- client commands: WS client against a running `serve` ---------------
if (
  cmd === 'query' ||
  cmd === 'reload' ||
  cmd === 'set-control' ||
  cmd === 'control-event' ||
  cmd === 'refresh-control' ||
  cmd === 'process' ||
  cmd === 'presence' ||
  cmd === 'suggest' ||
  cmd === 'callout' ||
  cmd === 'callout-clear' ||
  cmd === 'switch' ||
  cmd === 'errors'
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
      // (true/false, 6, "x"); a non-JSON word is the raw string.
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      const d = await sendSetControl(core, id, key, value);
      // Silent no-op (unknown key, wrong kind, out-of-range, unknown module)
      // shows here as controlState NOT reflecting `value`. setControl JIT-
      // resolves the node's module, so a just-edited schema is honoured
      // without a prior pull.
      const took =
        d.controlState && d.controlState[key] !== undefined
          ? JSON.stringify(d.controlState[key]) === JSON.stringify(value)
          : false;
      console.error(
        `${id}.${key} := ${JSON.stringify(value)} — ${
          took ? 'set' : 'IGNORED (unknown key, wrong kind/range, or no such control)'
        }; node ${d.status}. Re-process ${id} to apply.`
      );
      process.stdout.write(
        JSON.stringify(
          { status: d.status, controlState: d.controlState ?? null },
          null,
          2
        ) + '\n'
      );
    } else if (cmd === 'control-event') {
      let pr = rest;
      let json: string | undefined;
      [json, pr] = takeFlag(pr, 'json');
      const [node, event] = pr;
      if (!node || !event) {
        console.error(
          `control-event requires <node> <event> [--json '<payload>']\n\n${usage}`
        );
        process.exit(1);
      }
      let payload: unknown;
      if (json !== undefined) {
        try {
          payload = JSON.parse(json);
        } catch (err) {
          console.error(`--json is not valid JSON: ${(err as Error).message}`);
          process.exit(1);
        }
      }
      const r = await sendControlEvent(core, node, event, payload);
      const has = r.controlData !== undefined;
      console.error(
        `${node}: event "${event}" delivered — control ${
          has ? 're-derived' : 'unchanged (no free-form control / no handler)'
        }; node ${r.status}.`
      );
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    } else if (cmd === 'refresh-control') {
      const node = rest[0];
      if (!node) {
        console.error(`refresh-control requires <node>\n\n${usage}`);
        process.exit(1);
      }
      const r = await sendRefreshControl(core, node);
      const has = r.controlData !== undefined;
      console.error(
        `${node}: control ${
          has ? 're-derived' : 'unchanged (no free-form control)'
        }; node ${r.status} (no pull).`
      );
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    } else if (cmd === 'reload') {
      const r = await sendReload(core);
      const st = Object.entries(r.status)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.error(
        `reloaded ${r.file ?? ''} — ${r.nodes} nodes (${st || 'none'})`
      );
    } else if (cmd === 'switch') {
      const target = rest[0];
      if (!target) {
        console.error(`switch requires <file>\n\n${usage}`);
        process.exit(1);
      }
      // Resolve against THIS process's cwd before sending — the core resolves
      // relative paths against its own cwd, which may differ.
      const r = await sendSwitch(core, resolve(target));
      const st = Object.entries(r.status)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.error(`switched → ${r.file} — ${r.nodes} nodes (${st || 'none'})`);
    } else if (cmd === 'process') {
      const rerunIdx = rest.indexOf('--rerun-stale');
      const rerunStale = rerunIdx >= 0;
      if (rerunStale) rest = [...rest.slice(0, rerunIdx), ...rest.slice(rerunIdx + 1)];
      const node = rest[0];
      if (!node) {
        console.error(`process requires <node>\n\n${usage}`);
        process.exit(1);
      }
      const r = await sendProcess(core, node, { rerunStale });
      // Same shape as `query node` — caller gets errorStack / errorAt /
      // inputDigest / ports / moduleMtimeMs etc. without a follow-up query.
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

      // Build the change-set: --json takes a full ChangeSet or a bare edits
      // array; otherwise use the positional `<node> <field> <value>`.
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
        // `--json` accepts either a full ChangeSet object or just the edits
        // array (sugar). Both routes converge on a Partial<ChangeSet> view —
        // the partial is what makes the property reads below type-safe.
        const obj: Partial<ChangeSet> = Array.isArray(parsed)
          ? { edits: parsed }
          : (parsed as Partial<ChangeSet>);
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
      // Base36 timestamp id is unique-enough for the per-session use; agents
      // pass --id to re-announce/update an existing callout.
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
    } else if (cmd === 'errors') {
      await streamErrors(core, e => {
        // Line group: header (Monitor batches ≤200ms into one notification),
        // then stack or bare message. Each call is one stdout `write` so the
        // group stays atomic under concurrent writers.
        process.stdout.write(
          `node "${e.id}" failed\n${e.stack ?? e.message}\n`
        );
      });
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
      } else if (kind === 'logs') {
        const id = need('<id>');
        const [limit] = takeFlag(rest.slice(2), 'limit');
        q = { kind: 'logs', id, ...(limit ? { limit: Number(limit) } : {}) };
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
// --- copy the bundled agent skill into ~/.claude ------------------------
else if (cmd === 'install-skill') {
  let rest = argv.slice(1);
  let dest: string | undefined;
  [dest, rest] = takeFlag(rest, 'dest');

  // Source: <repo>/.claude/skills/cocoon, one dir up from this file.
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, '..', '.claude', 'skills', 'cocoon');
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    console.error(`install-skill: skill source not found at ${src}`);
    process.exit(1);
  }

  const target = dest ?? join(homedir(), '.claude', 'skills', 'cocoon');
  mkdirSync(dirname(target), { recursive: true });
  cpSync(src, target, { recursive: true, force: true });
  console.error(`installed cocoon skill → ${target}`);
}
// --- symlink this cli.ts into a writable PATH dir -----------------------
else if (cmd === 'install-cli') {
  let rest = argv.slice(1);
  let dest: string | undefined;
  [dest, rest] = takeFlag(rest, 'dest');

  // Resolve to the real on-disk path so the symlink survives `git pull`
  // (it points at the file in the repo, not a /tmp eval path).
  const here = dirname(fileURLToPath(import.meta.url));
  const src = realpathSync(join(here, 'cli.ts'));

  const defaultDest = join(homedir(), '.local', 'bin', 'cocoon');
  const target = dest ? dest.replace(/^~(?=\/|$)/, homedir()) : defaultDest;
  mkdirSync(dirname(target), { recursive: true });
  try {
    lstatSync(target);
    unlinkSync(target);
  } catch {
    // not there — fine
  }
  symlinkSync(src, target);
  console.error(`installed cocoon cli → ${target} → ${src}`);

  const binDir = dirname(target);
  const onPath = (process.env.PATH ?? '').split(':').some(p => p === binDir);
  if (!onPath) {
    console.error(
      `warning: ${binDir} is not on your PATH — \`cocoon\` won't be found. Add it (e.g. \`export PATH="${binDir}:$PATH"\` in your shell rc) or re-run with --dest pointing at a dir that is.`,
    );
  }
}
// --- file commands: own their own Runtime -------------------------------
else if (cmd === 'serve' || cmd === 'run') {
  let file = argv[1];
  if (!file) {
    console.error(usage);
    process.exit(1);
  }
  // Flow dir → its `cocoon.yml` / `index.yml`.
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
    const rerunStale = argv.includes('--rerun-stale');
    // node-guard would otherwise swallow `run`'s rejection; catch here so
    // a target failure produces a non-zero exit code.
    try {
      await run(file, target, format, { rerunStale });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
} else {
  console.error(usage);
  process.exit(1);
}
