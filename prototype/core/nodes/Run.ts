import { execSync } from 'node:child_process';
import { castFunction } from '../cast-function.ts';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Verbatim port of legacy `@cocoon/cocoon` Run (`nodes/io/Run.ts`). The only
 * adaptation is `context.cocoonFile.root` → the cocoon file's directory (the
 * prototype core resolves all relative I/O against it, like `ReadJSON`), so
 * `command` callbacks see the same cwd legacy gave them. Used by the imdb
 * example to `gzip -df` each downloaded archive.
 */
export const Run: CocoonProcessNode = {
  category: 'I/O',
  description: 'Runs a terminal command, optionally for each data item.',

  async *process(ctx) {
    const { command, data, stdio } = ctx.ports.read() as {
      command: string | ((item: unknown) => string);
      data?: unknown[];
      stdio?: 'pipe' | 'ignore' | 'inherit';
    };
    const cwd = ctx.resolvePath();
    ctx.debug(`executing "${command}"`);

    let commandCallback: ((item: unknown) => string) | undefined;
    try {
      commandCallback = castFunction(command);
    } catch {
      // Not a function — run the literal command once (legacy behaviour).
    }

    if (commandCallback && data) {
      const stdout = data
        .map(item => {
          const cmd = commandCallback!(item);
          ctx.debug(`running "${cmd}"`);
          return execSync(cmd, { cwd, stdio });
        })
        .map(x => (x ? x.toString() : undefined));
      ctx.ports.write({ data, stdout });
      return `Ran command for ${data.length} items`;
    }

    const stdout = execSync(command as string, { cwd, stdio });
    ctx.ports.write({ data, stdout: stdout ? stdout.toString() : undefined });
    return `Ran "${command}"`;
  },
};
