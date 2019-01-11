import { ChildProcess, spawn } from 'child_process';
import Debug from 'debug';
import path from 'path';
import { initialiseIPC, onMemoryUsageRequest } from '../common/ipc';
import { isDev } from '../webpack.config';

export async function initialise() {
  Debug.enable('core:*,main:*,common:*');
  if (isDev) {
    process.on('warning', e => console.warn(e.stack));
  }

  // Create a fork of this process which will allocate the graph and handle all
  // operations on it, since doing computationally expensive operations on the
  // main thread would freeze the UI thread as well.
  const coreProcess = spawn(
    'node',
    ['--inspect=9339', path.resolve(__dirname, '../core/index')],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );

  // End core process when exiting
  process.on('exit', () => {
    coreProcess.send('close'); // Notify core process via IPC
    process.exit(0);
  });

  // Wait for IPC and core process
  await Promise.all([initialiseIPC(), waitForReadySignal(coreProcess)]);

  // Send memory usage reports
  onMemoryUsageRequest(() => ({
    memoryUsage: process.memoryUsage(),
    process: 'main',
  }));
}

export function getDefinitionsPathFromArgv() {
  const lastArgument = process.argv[process.argv.length - 1];
  return lastArgument.match(/\.ya?ml$/i) ? resolveFilePath(lastArgument) : null;
}

function resolveFilePath(filePath: string) {
  if (filePath[0] === '~') {
    return path.join(process.env.HOME || '', filePath.slice(1));
  }
  return path.resolve(filePath);
}

async function waitForReadySignal(childProcess: ChildProcess) {
  await new Promise(resolve =>
    childProcess.on('message', m => {
      if (m === 'ready') {
        resolve();
      }
    })
  );
}
