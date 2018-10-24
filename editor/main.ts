import { app, BrowserWindow } from 'electron';
import { open, run } from '../core';
import { CocoonNode } from '../core/graph';
import { isDev } from '../webpack.config';
import {
  coreOnEvaluateNode,
  coreOnOpenDefinitions,
  mainOnGetMemoryUsage,
  mainOnOpenDataViewWindow,
  mainSendMemoryUsage,
  uiSendDataViewWindowUpdate,
} from './ipc';
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

coreOnOpenDefinitions((event, definitionsPath) => {
  open(definitionsPath, event.sender);
});

coreOnEvaluateNode((event, nodeId) => {
  run(nodeId, event.sender, (node: CocoonNode) => {
    // Update open data windows when a node finished evaluation
    debug('node evaluated', node.id);
    const window = dataWindows[node.id];
    if (window) {
      debug(`updating data view window for node "${node.id}"`);
      uiSendDataViewWindowUpdate(window, node.renderingData);
    }
  });
});

mainOnOpenDataViewWindow((event, nodeId) => {
  const node = global.graph.find(n => n.id === nodeId);
  if (node === undefined) {
    throw new Error();
  }
  let window = dataWindows[nodeId];
  if (window) {
    window.focus();
  } else {
    const data: DataViewWindowData = {
      nodeId,
      nodeType: node.type,
      renderingData: node.renderingData,
    };
    window = createWindow(
      'data-view.html',
      {
        title: `Data for ${nodeId}`,
      },
      false,
      data
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
