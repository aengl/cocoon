import { app, BrowserWindow, ipcMain } from 'electron';
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer';
import * as path from 'path';
import { open, run } from '../core';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null;

const isDev = Boolean(process.env.DEBUG);

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    height: 840,
    title: 'Cocoon2',
    webPreferences: {
      nodeIntegration: isDev,
    },
    width: 1280,
  });

  // if (isDev) {
  //   mainWindow.loadURL('http://localhost:3000/index.html');
  // } else {
  mainWindow.loadURL(
    path.join('file://', path.resolve('editor/renderer/index.html'))
  );
  // }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open dev tools
  if (isDev) {
    mainWindow.webContents.openDevTools();
    // mainWindow.maximize();
    require('devtron').install();
    installExtension(REACT_DEVELOPER_TOOLS);
  }
});

ipcMain.on('open', (event: Electron.Event, definitionsPath: string) => {
  open(definitionsPath);
});

ipcMain.on('run', (event: Electron.Event, nodeId: string) => {
  run(nodeId, event.sender);
});
