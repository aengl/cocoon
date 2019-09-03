import { DebugFunction } from '@cocoon/types';
import { ChildProcess, spawn } from 'child_process';

interface SpawnChildProcessOptions {
  args?: string[];
  cwd?: string;
  debug?: DebugFunction;
}

export default function(command: string, options: SpawnChildProcessOptions) {
  const childProcess = spawn(command, options.args || [], {
    cwd: options.cwd,
    shell: true,
    stdio: [process.stdin, process.stdout, process.stderr],
  });
  if (options.debug) {
    options.debug(`spawning child process "${command}"`, options.args);
  }
  return waitForProcess(childProcess);
}

export function waitForProcess(
  childProcess: ChildProcess
): Promise<Error | null> {
  return new Promise((resolve, reject) => {
    childProcess.once('exit', (code: number, signal: string) =>
      code === 0
        ? resolve(null)
        : reject(new Error('process failed with code: ' + code))
    );
    childProcess.once('error', (err: Error) => reject(err));
  });
}
