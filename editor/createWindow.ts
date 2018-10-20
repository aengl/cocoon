import devtron from 'devtron';
import { BrowserWindow } from 'electron';
import installExtension, {
  REACT_DEVELOPER_TOOLS,
} from 'electron-devtools-installer';
import _ from 'lodash';
import path from 'path';
import { isDev } from '../webpack.config';

export function createWindow(
  htmlFile: string,
  options: Electron.BrowserWindowConstructorOptions,
  devTools = false,
  data?: any
) {
  const window = new BrowserWindow(
    _.merge(
      {
        backgroundColor: 'black',
        webPreferences: {
          nodeIntegration: true,
        },
      },
      options
    )
  );

  // Attach data to window
  _.assign(window, data);

  // Load file
  if (isDev) {
    window.loadURL(`http://localhost:8080/${htmlFile}`);
  } else {
    window.loadFile(path.resolve(__dirname, 'ui', htmlFile));
  }

  // Open dev tools
  if (devTools) {
    window.webContents.openDevTools();
    devtron.install();
    installExtension(REACT_DEVELOPER_TOOLS);
  }

  return window;
}
