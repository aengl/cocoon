import { fork } from 'child_process';
import { app, BrowserWindow } from 'electron';
import { onOpenDataViewWindow } from '../ipc';
import { isDev } from '../webpack.config';
import { mainOnGetMemoryUsage, mainSendMemoryUsage } from './ipc';
import { DataViewWindowData, EditorWindowData } from './shared';
import { createWindow } from './window';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null = null;
const dataWindows: { [nodeId: string]: BrowserWindow | null } = {};

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

if (isDev) {
  process.on('warning', e => console.warn(e.stack));
}

app.on('ready', () => {
  const lastArgument = process.argv[process.argv.length - 1];
  const data: EditorWindowData = {
    definitionsPath: lastArgument.match(/\.ya?ml$/i) ? lastArgument : null,
  };
  debug(`creating editor window`);
  mainWindow = createWindow(
    'editor.html',
    {
      height: 840,
      title: 'Cocoon2',
      width: 1280,
    },
    true,
    data
  );
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
        title: `Data for ${nodeId}`,
      },
      false,
      args as DataViewWindowData
    );
    window.on('closed', () => {
      delete dataWindows[nodeId];
    });
    dataWindows[nodeId] = window;
  }
});

mainOnGetMemoryUsage(event => {
  mainSendMemoryUsage(event, process.memoryUsage());
});

// Create a fork of this process which will allocate the graph and handle all
// operations on it, since doing computationally expensive operations on the
// main thread would freeze the UI thread as well.
debug(`creating core process`);
fork('core/index');
