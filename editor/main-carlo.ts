import carlo from 'carlo';
import path from 'path';
import { onOpenDataViewWindow } from '../common/ipc';
import { isDev } from '../webpack.config';
import { createURI, initialise } from './main-common';

const debug = require('../common/debug')('main:main');
const packageJson = require('../package.json');

const dataWindows: { [nodeId: string]: any } = {};

process.on('unhandledRejection', error => {
  // Puppeteer likes to be very verbose when the RPC connection closes, so let's
  // just ignore all of that
  process.exit(0);
});

export async function initialiseCarlo(definitionsPath?: string) {
  await Promise.all([launchCarlo(), initialise()]).then(async ([app, _0]) => {
    // Open data view windows
    onOpenDataViewWindow(async args => {
      const { nodeId } = args;
      let window = dataWindows[nodeId];
      if (window !== undefined) {
        window.bringToFront();
      } else {
        debug(`creating data view window`);
        window = await app.createWindow({
          bgcolor: '#000000',
          height: 840,
          width: 1280,
        });
        loadFile(window, 'dataView.html', { nodeId });
        window.on('close', () => {
          delete dataWindows[nodeId];
        });
        dataWindows[nodeId] = window;
      }
    });

    // Create main window
    await loadFile(app, 'editor.html', { definitionsPath });
  });
}

async function launchCarlo() {
  const app = await carlo.launch({
    bgcolor: '#000000',
    title: `${packageJson.displayName} ${packageJson.version}`,
  });
  app.on('exit', () => {
    process.exit();
  });
  return app;
}

async function loadFile(window: any, file: string, args: object) {
  if (isDev) {
    await window.load(createURI(file, args));
  } else {
    const root = path.resolve(__dirname, 'ui');
    window.serveFolder(root);
    await window.load(createURI(file, args, false));
  }
}
