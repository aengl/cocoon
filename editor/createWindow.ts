import { BrowserWindow } from 'electron';
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer';
import _ from 'lodash';
import path from 'path';
import { isDev } from './main';

export function createWindow(
  filePath: string,
  options: Electron.BrowserWindowConstructorOptions,
  data?: any
) {
  const window = new BrowserWindow(
    _.merge(
      {
        webPreferences: {
          nodeIntegration: isDev,
        },
      },
      options
    )
  );

  // Attach data to window
  _.assign(window, data);

  // Load file
  window.loadFile(path.resolve(filePath));

  // Open dev tools
  if (isDev) {
    window.webContents.openDevTools();
    // window.maximize();
    require('devtron').install();
    installExtension(REACT_DEVELOPER_TOOLS);
  }

  return window;
}
