import { spawn } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { onMemoryUsageRequest, onOpenDataViewWindow } from '../common/ipc';
import { isDev } from '../webpack.config';
import { DataViewWindowData, EditorWindowData } from './shared';
import { createWindow } from './window';

const debug = require('../common/debug')('main:main');
const packageJson = require('../package.json');

let mainWindow: BrowserWindow | null = null;
const dataWindows: { [nodeId: string]: BrowserWindow | null } = {};

function resolveFilePath(filePath: string) {
  if (filePath[0] === '~') {
    return path.join(process.env.HOME || '', filePath.slice(1));
  }
  return path.resolve(filePath);
}

// Create a fork of this process which will allocate the graph and handle all
// operations on it, since doing computationally expensive operations on the
// main thread would freeze the UI thread as well.
debug(`creating core process`);
const coreProcess = spawn(
  'node',
  ['--inspect=9339', path.resolve(__dirname, '../core/index')],
  {
    cwd: path.resolve(__dirname, '..'),
    detached: false,
    stdio: 'inherit',
  }
);

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

if (isDev) {
  process.on('warning', e => console.warn(e.stack));
}

// TODO: wait for core ready signal to make sure the IPC server is up

app.on('ready', () => {
  const lastArgument = process.argv[process.argv.length - 1];
  const title = `Cocoon2 v${packageJson.version}`;
  const data: EditorWindowData = {
    definitionsPath: lastArgument.match(/\.ya?ml$/i)
      ? resolveFilePath(lastArgument)
      : null,
    windowTitle: title,
  };
  debug(`creating editor window`);
  mainWindow = createWindow(
    'editor.html',
    {
      height: 840,
      title,
      width: 1280,
    },
    true,
    data as EditorWindowData
  );
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('quit', () => {
  coreProcess.kill();
  process.exit(0);
});

onOpenDataViewWindow(args => {
  const { nodeId } = args;
  let window = dataWindows[nodeId];
  if (window) {
    window.focus();
  } else {
    debug(`creating data view window`);
    window = createWindow(
      'data-view.html',
      {
        height: 600,
        title: nodeId,
        width: 1000,
      },
      true,
      args as DataViewWindowData
    );
    window.on('closed', () => {
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
