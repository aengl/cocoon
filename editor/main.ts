import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { CocoonDefinitions } from '../core/definitions';
import { parseYamlFile } from '../core/fs';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null;

const isDev = Boolean(process.env.DEBUG);

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 840,
    title: 'Cocoon2',
    webPreferences: {
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(
    path.join('file://', path.resolve('editor/renderer/index.html'))
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open dev tools
  if (isDev) {
    mainWindow.webContents.openDevTools();
    // mainWindow.maximize();
    require('devtron').install();
  }
});

export function loadDefinitions(): CocoonDefinitions {
  const definitions: CocoonDefinitions = parseYamlFile(
    path.resolve('test.yml')
  );
  debug(definitions);
  return definitions;
}
