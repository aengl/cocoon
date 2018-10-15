import { app, BrowserWindow } from 'electron';
import { open, run } from '../core';
import { CocoonNode } from '../core/graph';
import { createWindow } from './createWindow';
import {
  mainOnEvaluateNode,
  mainOnOpenDataViewWindow,
  mainOnOpenDefinitions,
  rendererSendDataViewWindowUpdate,
} from './ipc';
import { isDev } from './webpack.config';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null = null;
const dataWindows: { [nodeId: string]: BrowserWindow | null } = {};

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

if (isDev) {
  process.on('warning', e => console.warn(e.stack));
}

app.on('ready', () => {
  mainWindow = createWindow(
    'editor/renderer/editor.html',
    {
      height: 840,
      title: 'Cocoon2',
      width: 1280,
    },
    true,
    {
      definitionsPath: process.argv.length >= 3 ? process.argv[2] : null,
    }
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
    debug('node evaluated', node.definition.id);
    const window = dataWindows[node.definition.id];
    if (window) {
      debug(`updating data view window for node "${node.definition.id}"`);
      rendererSendDataViewWindowUpdate(window, node.renderingData);
    }
  });
});

mainOnOpenDataViewWindow((event, nodeId) => {
  const node = global.graph.find(n => n.definition.id === nodeId);
  if (node === undefined) {
    throw new Error();
  }
  let window = dataWindows[nodeId];
  if (window) {
    window.focus();
  } else {
    window = createWindow(
      'editor/renderer/data.html',
      {
        title: `Data for ${nodeId}`,
      },
      false,
      {
        nodeId,
        nodeType: node.type,
        renderingData: node.renderingData,
      }
    );
    window.on('closed', () => {
      delete dataWindows[nodeId];
    });
    dataWindows[nodeId] = window;
  }
});
