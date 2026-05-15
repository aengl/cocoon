import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { castFunction } from '../cast-function.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Verbatim port of legacy `@cocoon/cocoon` Pipe (`nodes/io/Pipe.ts`). Pipes a
 * whole collection into a shell command via stdin and reads the result back
 * from stdout, with optional `serialise`/`deserialise` callbacks (e.g.
 * `JSON.stringify` / `JSON.parse`). The only adaptation is
 * `context.cocoonFile.root` → the cocoon file's directory, like `Run`, so
 * relative commands (`./generator.py`, `./plot.r`) resolve as legacy gave
 * them. Zero new deps — `node:child_process` `spawnSync`. Powers the imdb-free
 * `interop` example (Python/R via stdin/stdout JSON).
 */
export const Pipe: CocoonProcessNode = {
  category: 'I/O',
  description:
    'Pipes an entire collection into a terminal command via stdin, and reads the result back from stdout.',

  async *process(ctx) {
    const { command, data, deserialise, serialise } = ctx.ports.read() as {
      command: string;
      data?: unknown;
      deserialise?: string | ((x: string) => unknown);
      serialise?: string | ((x: unknown) => string);
    };
    ctx.debug(`executing "${command}"`);

    const result = spawnSync(command, {
      cwd: path.dirname(ctx.cocoonFilePath),
      input:
        data !== undefined && data !== null
          ? serialise
            ? castFunction<(x: unknown) => string>(serialise)!(data)
            : String(data)
          : undefined,
      shell: true,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `process returned with status ${result.status}\n\n${result.stderr?.toString() ?? ''}`
      );
    }

    const stdout = result.stdout?.toString() ?? '';
    const out =
      stdout.length > 0
        ? deserialise
          ? castFunction<(x: string) => unknown>(deserialise)!(stdout)
          : stdout
        : null;
    ctx.ports.write({ data: out });
    return Array.isArray(out)
      ? `Piped ${out.length} items through "${command}"`
      : `Piped through "${command}"`;
  },
};
