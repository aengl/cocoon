/**
 * Cross-session "recently served flows" list — the only state the core keeps
 * outside a flow's own directory. A small JSON array of absolute flow paths,
 * most-recent first, at `~/.cocoon/recents.json`. Written when a core starts
 * serving a file and when it switches to another; read to populate the
 * editor's path-switch dropdown.
 *
 * Synchronous on purpose: it's tiny and touched only on connect / switch, so
 * the WS `hello` can carry `recents` without an async hop. Best-effort
 * throughout — a recents list is a convenience, never load-bearing, so every
 * fs error degrades to "no recents" rather than failing the core.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RECENTS_FILE = path.join(os.homedir(), '.cocoon', 'recents.json');
const MAX = 20;

function read(): string[] {
  try {
    const arr = JSON.parse(fs.readFileSync(RECENTS_FILE, 'utf8'));
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    fs.mkdirSync(path.dirname(RECENTS_FILE), { recursive: true });
    fs.writeFileSync(RECENTS_FILE, JSON.stringify(list, null, 2) + '\n');
  } catch {
    /* best-effort — recents are a convenience, not load-bearing */
  }
}

/**
 * Record an absolute flow path as most-recently-used. Dedupes, prunes entries
 * that no longer exist on disk, and caps the list. Returns the pruned,
 * existing-only list (most-recent first) so callers can broadcast it without a
 * second read.
 */
export function recordRecent(absPath: string): string[] {
  const abs = path.resolve(absPath);
  const next = [abs, ...read().filter(p => p !== abs)]
    .filter(p => fs.existsSync(p))
    .slice(0, MAX);
  write(next);
  return next;
}

/** Existing recent flow paths, most-recent first. Dead entries are filtered
 *  out on read so the dropdown only ever offers files that still exist. */
export function listRecents(): string[] {
  return read().filter(p => fs.existsSync(p));
}
