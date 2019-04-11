import { ChildProcess, spawn } from 'child_process';
import Debug from 'debug';
import path from 'path';
import {
  initialiseIPC,
  onRequestCoreURI,
  onRequestMemoryUsage,
} from '../common/ipc';
import { isDev } from '../webpack.config';

const debug = require('../common/debug')('main:main-common');

export async function initialise(options: { coreURI?: string } = {}) {
  Debug.enable('core:*,main:*,common:*');
  if (isDev) {
    process.on('warning', e => console.warn(e.stack));
  }

  // Initialise core and IPC
  if (options.coreURI) {
    await initialiseIPC();
    debug(`using remote kernel at "${options.coreURI}"`);

    // The main process will have to proxy the core URI to the editor, since the
    // editor has no way of knowing what options parameter we passed
    onRequestCoreURI(() => ({ uri: options.coreURI }));
  } else {
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
    debug(`created local processing kernel`);

    // Send an empty response so that the editor will determine the core URI
    // automatically by falling back to its default value
    onRequestCoreURI(() => ({}));
  }

  // Send memory usage reports
  onRequestMemoryUsage(() => ({
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
