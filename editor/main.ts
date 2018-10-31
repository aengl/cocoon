import { spawn } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import {
  deserialiseNode,
  onOpenDataViewWindow,
  sendMainMemoryUsage,
} from '../common/ipc';
import { findFile } from '../core/fs';
import { isDev } from '../webpack.config';
import { DataViewWindowData, EditorWindowData } from './shared';
import { createWindow } from './window';

const debug = require('debug')('cocoon:main');
const packageJson = require('../package.json');

let mainWindow: BrowserWindow | null = null;
const dataWindows: { [nodeId: string]: BrowserWindow | null } = {};

// Create a fork of this process which will allocate the graph and handle all
// operations on it, since doing computationally expensive operations on the
// main thread would freeze the UI thread as well.
debug(`creating core process`);
const coreProcess = spawn(
  'node',
  ['--inspect=9339', path.resolve(__dirname, '../core/index')],
  {
    cwd: path.resolve(__dirname, '..'),
  }
);

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

if (isDev) {
  process.on('warning', e => console.warn(e.stack));
}

app.on('ready', () => {
  const lastArgument = process.argv[process.argv.length - 1];
  const title = `Cocoon2 v${packageJson.version}`;
  const data: EditorWindowData = {
    definitionsPath: lastArgument.match(/\.ya?ml$/i)
      ? findFile(lastArgument)
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
    data
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
  const { serialisedNode } = args;
  const node = deserialiseNode(serialisedNode);
  let window = dataWindows[node.id];
  if (window) {
    window.focus();
  } else {
    debug(`creating data view window`);
    window = createWindow(
      'data-view.html',
      {
        height: 600,
        title: node.id,
        width: 1000,
      },
      true,
      args as DataViewWindowData
    );
    window.on('closed', () => {
      delete dataWindows[node.id];
    });
    dataWindows[node.id] = window;
  }
});

// Send memory usage reports
setInterval(() => {
  sendMainMemoryUsage({ memoryUsage: process.memoryUsage() });
}, 1000);
