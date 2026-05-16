/**
 * `cocoon` CLI — the single entry point over the standalone core library.
 *
 *   cocoon serve <file> [--port 4000]
 *   cocoon run   <file> --target cocoon://Node/out/port [--format json|table]
 *
 * Run with Node directly (types stripped at runtime, no build step):
 *   node core/cli.ts serve ../examples/simple-api/cocoon.yml
 */
import { run } from './run.ts';
import { serve } from './serve.ts';

const [, , cmd, file, ...rest] = process.argv;

function flag(name: string, fallback?: string) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
}

const usage = `Usage:
  cocoon serve <file> [--port 4000]
  cocoon run   <file> --target cocoon://Node/out/port [--format json|table]`;

if (!cmd || !file) {
  console.error(usage);
  process.exit(1);
}

if (cmd === 'serve') {
  await serve(file, Number(flag('port', '4000')));
} else if (cmd === 'run') {
  const target = flag('target');
  if (!target) {
    console.error('run requires --target cocoon://Node/out/port');
    process.exit(1);
  }
  const format = flag('format', 'json') as 'json' | 'table';
  // Own the headless exit code explicitly. `run` rejects when the *target*
  // node couldn't be produced (the documented "non-zero only if the requested
  // target failed" contract); catching it here keeps that intact independently
  // of node-guard, which otherwise swallows the now-unhandled rejection.
  try {
    await run(file, target, format);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
} else {
  console.error(usage);
  process.exit(1);
}
