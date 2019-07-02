import { DebugFunction } from '@cocoon/types';
import { spawn } from 'child_process';

interface SpawnChildProcessOptions {
  args?: string[];
  cwd?: string;
  debug?: DebugFunction;
}

export default function(
  command: string,
  options: SpawnChildProcessOptions
): Promise<void> {
  const p = spawn(command, options.args, {
    cwd: options.cwd,
    shell: true,
  });
  if (options.debug) {
    options.debug(`spawning child process "${command}"`, options.args);
  }
  return new Promise((resolve, reject) => {
    p.stdout!.on('data', data => {
      process.stdout.write(data.toString());
    });
    p.stderr!.on('data', data => {
      process.stderr.write(data.toString());
    });
    p.on('close', code => {
      if (options.debug) {
        options.debug(`child process terminated: "${command}"`);
      }
      code > 0 ? reject(`child process returned code ${code}`) : resolve();
    });
  });
}
