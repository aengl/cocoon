/**
 * Flow-local environment. Nodes see `<flowdir>/.env`, `<flowdir>/.env.defaults`,
 * and the YAML `env:` block as `process.env`. Precedence (highest first):
 *
 *   pre-existing process.env  >  .env  >  .env.defaults  >  YAML `env:`
 *
 * Nothing already exported is clobbered. Missing files are skipped silently.
 * Dependency-free; the grammar is plain `KEY=VALUE` with `#` comments.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

/** Apply a flow's env to `process.env` in place, never overriding a value
 *  already set. Call after parsing the flow, before processing any node. */
export function loadFlowEnv(
  cocoonFilePath: string,
  yamlEnv: Record<string, unknown> | undefined
): void {
  const dir = path.dirname(path.resolve(cocoonFilePath));

  // .env.defaults (lowest-priority file), then .env overrides it.
  const fromFiles = {
    ...parseDotenv(path.join(dir, '.env.defaults')),
    ...parseDotenv(path.join(dir, '.env')),
  };
  for (const [k, v] of Object.entries(fromFiles)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  // YAML `env:` is the lowest priority overall.
  if (yamlEnv) {
    for (const [k, v] of Object.entries(yamlEnv)) {
      if (process.env[k] === undefined && v != null) {
        process.env[k] = String(v);
      }
    }
  }
}
