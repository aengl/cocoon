import { app, BrowserWindow } from 'electron';
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer';
import * as path from 'path';
import { CocoonDefinitions } from '../core/definitions';
import { parseYamlFile } from '../core/fs';

const debug = require('debug')('cocoon:main');

let mainWindow: BrowserWindow | null;

const isDev = Boolean(process.env.DEBUG);

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Cocoon2',
    webPreferences: {
      nodeIntegration: isDev,
    },
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

export function loadDefinitions(): CocoonDefinitions {
  const definitions: CocoonDefinitions = parseYamlFile(
    path.resolve('test.yml')
  );
  debug(definitions);
  return definitions;
}
