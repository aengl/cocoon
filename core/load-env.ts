/**
 * Flow-local environment loading. Legacy-faithful port of what the old
 * `@cocoon/cocoon` did at cocoon-file parse time
 * (`packages/cocoon/src/index.ts`, via `dotenv-extended`): a flow's nodes see
 * `<flowdir>/.env` + `<flowdir>/.env.defaults` and the YAML `env:` block as
 * `process.env`. The Tibi `boardgames.yml` relies on this — `ReadCatirpelData`
 * reads libpq `PG*` vars that live only in `cocoon-next/.env.defaults`, and
 * the `Publish*` nodes read `PROJECT_ROOT`/`LOCALES` from the YAML `env:`.
 *
 * Dependency-free on purpose (the prototype has no `dotenv`): the `.env*`
 * files in play are plain `KEY=VALUE` with `#` comments. The one contract that
 * matters is the **precedence**, identical to the legacy
 * `dotenv-extended` defaults (`overrideProcessEnv:false`) plus the legacy
 * `process.env = { ...file.env, ...process.env }` merge:
 *
 *   pre-existing process.env  >  .env  >  .env.defaults  >  YAML `env:`
 *
 * i.e. nothing already exported is ever clobbered; a real exported
 * `PGPASSWORD` still wins over any file. Missing files are skipped silently
 * (legacy tolerated this too — note `.env.defaults` deliberately omits
 * `PGPASSWORD`). `.env.schema` is intentionally not enforced: legacy passed it
 * but with default options never errored on a missing var, so honouring it
 * would change behaviour, not preserve it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Minimal dotenv grammar: `KEY=VALUE`, `#` comments, optional surrounding
 *  quotes, `export ` prefix tolerated. Sufficient for the `.env*` in play. */
function parseDotenv(filePath: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return {}; // missing/unreadable — skip, like legacy
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

/**
 * Apply a flow's env to `process.env`, in place, never overriding a value
 * that is already set (so a real exported var always wins). Call once, after
 * the cocoon file is parsed and before any node is processed.
 */
export function loadFlowEnv(
  cocoonFilePath: string,
  yamlEnv: Record<string, unknown> | undefined
): void {
  const dir = path.dirname(path.resolve(cocoonFilePath));

  // .env.defaults (lowest of the files) then .env overrides it.
  const fromFiles = {
    ...parseDotenv(path.join(dir, '.env.defaults')),
    ...parseDotenv(path.join(dir, '.env')),
  };
  for (const [k, v] of Object.entries(fromFiles)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  // YAML `env:` is the lowest priority of all (legacy:
  // `process.env = { ...file.env, ...process.env }`).
  if (yamlEnv) {
    for (const [k, v] of Object.entries(yamlEnv)) {
      if (process.env[k] === undefined && v != null) {
        process.env[k] = String(v);
      }
    }
  }
}
