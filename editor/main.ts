import carlo from 'carlo';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import {
  initialiseIPC,
  onMemoryUsageRequest,
  onOpenDataViewWindow,
} from '../common/ipc';
import { isDev } from '../webpack.config';

const debug = require('../common/debug')('main:main');
const packageJson = require('../package.json');

const dataWindows: { [nodeId: string]: any } = {};

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

if (isDev) {
  process.on('warning', e => console.warn(e.stack));
}

process.on('exit', () => {
  coreProcess.send('close'); // Notify core process via IPC
  process.exit(0);
});

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

async function launchCarlo() {
  const app = await carlo.launch({
    bgcolor: '#000000',
    title: `${packageJson.displayName} ${packageJson.version}`,
  });
  app.on('exit', () => {
    process.exit();
  });
  return app;
}

async function loadUri(window: any, uri: string) {
  if (isDev) {
    await window.load(`http://127.0.0.1:32901/${uri}`);
  } else {
    const root = path.resolve(__dirname, 'ui');
    window.serveFolder(root);
    await window.load(uri);
  }
}

Promise.all([
  launchCarlo(),
  initialiseIPC(),
  waitForReadySignal(coreProcess),
]).then(async ([app, _0, _1]) => {
  // Open data view windows
  onOpenDataViewWindow(async args => {
    const { nodeId } = args;
    let window = dataWindows[nodeId];
    if (window !== undefined) {
      window.bringToFront();
    } else {
      debug(`creating data view window`);
      window = await app.createWindow({
        bgcolor: '#000000',
        height: 840,
        width: 1280,
      });
      loadUri(window, `data-view.html?nodeId=${nodeId}`);
      window.on('close', () => {
        delete dataWindows[nodeId];
      });
      dataWindows[nodeId] = window;
    }
  });

  // Send memory usage reports
  onMemoryUsageRequest(() => ({
    memoryUsage: process.memoryUsage(),
    process: 'main',
  }));

  // Create main window
  const lastArgument = process.argv[process.argv.length - 1];
  const definitionsPath = lastArgument.match(/\.ya?ml$/i)
    ? resolveFilePath(lastArgument)
    : null;
  await loadUri(app, `editor.html?definitionsPath=${definitionsPath}`);
  await app.maximize();
});
