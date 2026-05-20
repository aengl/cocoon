/**
 * Absolute path of the fixture-nodes dir, for tests that need a `nodeDirs:`
 * pointing at it. The keystone-6 resolver searches two roots (the cocoon
 * file's own `nodes/` + declared `nodeDirs:`); tests typically have no
 * sibling `nodes/`, so they declare this dir as the one root.
 *
 * Why this exists at all: core ships zero built-in nodes (CLAUDE.md, the
 * function-library cut). Tests that previously used `Map`/`Filter`/
 * `ReadJSON` as carriers of unrelated runtime mechanics (port concat,
 * reload diff, persist hydrate, …) need a tiny, test-only home for them.
 * These files are NOT production nodes; they are fixtures.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_NODES_DIR = path.dirname(fileURLToPath(import.meta.url));
