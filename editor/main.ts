import { app, BrowserWindow, ipcMain } from 'electron';
import { open, run } from '../core';
import { createWindow } from './createWindow';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null = null;
const dataWindows: { [nodeId: string]: BrowserWindow | null } = {};
export const isDev = Boolean(process.env.DEBUG);

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

if (isDev) {
  // tslint:disable-next-line:no-console
  process.on('warning', e => console.warn(e.stack));
}

app.on('ready', () => {
  mainWindow = createWindow('editor/renderer/editor.html', {
    height: 840,
    title: 'Cocoon2',
    width: 1280,
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

ipcMain.on('open', (event: Electron.Event, definitionsPath: string) => {
  open(definitionsPath, event.sender);
});

ipcMain.on('run', (event: Electron.Event, nodeId: string) => {
  run(nodeId, event.sender);
});

ipcMain.on('open-data-window', (event: Electron.Event, nodeId: string) => {
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
        webPreferences: {
          nodeIntegration: isDev,
        },
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
