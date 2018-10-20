import { app, BrowserWindow } from 'electron';
import { open, run } from '../core';
import { CocoonNode } from '../core/graph';
import { isDev } from '../webpack.config';
import { createWindow } from './createWindow';
import {
  mainOnEvaluateNode,
  mainOnOpenDataViewWindow,
  mainOnOpenDefinitions,
  uiSendDataViewWindowUpdate,
} from './ipc';
import { DataViewWindowData, EditorWindowData } from './shared';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null = null;
const dataWindows: { [nodeId: string]: BrowserWindow | null } = {};

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

if (isDev) {
  process.on('warning', e => console.warn(e.stack));
}

app.on('ready', () => {
  const data: EditorWindowData = {
    definitionsPath: process.argv.length >= 3 ? process.argv[2] : null,
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

mainOnOpenDefinitions((event, definitionsPath) => {
  open(definitionsPath, event.sender);
});

mainOnEvaluateNode((event, nodeId) => {
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
