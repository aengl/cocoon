/**
 * Flow-local environment. Nodes see `<flowdir>/.env`, `<flowdir>/.env.defaults`,
 * and the YAML `env:` block as `process.env`. Precedence (highest first):
 *
 *   externally-set process.env  >  .env  >  .env.defaults  >  YAML `env:`
 *
 * "Externally-set" means set by something other than us — the operator's shell
 * exports, the host. Those are never clobbered. But values *we* injected on a
 * previous call are ours to refresh: on `reload` a changed `.env` value
 * propagates and a removed one is dropped, instead of the old behaviour where
 * our own prior injection looked "pre-existing" and froze the env until the
 * core restarted. Missing files are skipped silently. Dependency-free; the
 * grammar is plain `KEY=VALUE` with `#` comments.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Keys this module injected on the previous `loadFlowEnv`. They are ours to
 *  overwrite (a changed file value) or delete (a key removed from the files) —
 *  distinct from genuinely-external `process.env`, which always wins. One flow
 *  per core process, so a module-global set is enough; a second flow loaded in
 *  the same process simply inherits this as "what the prior flow owned". */
let injected = new Set<string>();

/** Minimal dotenv: `KEY=VALUE`, `#` comments, optional surrounding quotes,
 *  `export ` prefix tolerated. */
function parseDotenv(filePath: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return {}; // missing/unreadable — skip
  }
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** Apply a flow's env to `process.env` in place. Externally-set vars win and
 *  are never overwritten; vars we injected on a prior call are refreshed from
 *  the files. Call after parsing the flow, before processing any node. */
export function loadFlowEnv(
  cocoonFilePath: string,
  yamlEnv: Record<string, unknown> | undefined
): void {
  const dir = path.dirname(path.resolve(cocoonFilePath));

  // Build the desired file/YAML env lowest-priority first so higher overwrites:
  //   YAML env  <  .env.defaults  <  .env
  const desired: Record<string, string> = {};
  if (yamlEnv) {
    for (const [k, v] of Object.entries(yamlEnv))
      if (v != null) desired[k] = String(v);
  }
  Object.assign(
    desired,
    parseDotenv(path.join(dir, '.env.defaults')),
    parseDotenv(path.join(dir, '.env'))
  );

  // Drop keys we injected last time that are gone now, so a var deleted from
  // .env doesn't linger across reloads. (We only ever delete our own keys.)
  for (const k of injected)
    if (!(k in desired)) delete process.env[k];

  const next = new Set<string>();
  for (const [k, v] of Object.entries(desired)) {
    // Sacred iff set by something other than us: present in process.env and not
    // a key we injected. The operator's exports (and anything the host set) win.
    if (process.env[k] !== undefined && !injected.has(k)) {
      // The silent-shadow case that reads as ".env isn't being picked up":
      // a real shell export overrides a file value. Surface it once per load.
      if (process.env[k] !== v) {
        console.warn(
          `[cocoon] env ${k}: external value kept; .env/.env.defaults/YAML ` +
            `value ignored — unset ${k} in the core's shell to use the file`
        );
      }
      continue;
    }
    process.env[k] = v;
    next.add(k);
  }
  injected = next;
}
