import carlo from 'carlo';
import { initialise } from './main-common';
import { createEditorURI } from './uri';

const packageJson = require('../package.json');

export async function initialiseCarlo(
  options: {
    coreURI?: string;
    definitionsPath?: string;
  } = {}
) {
  const [app, _0] = await Promise.all([launchCarlo(), initialise(options)]);
  await app.load(
    createEditorURI('editor.html', { file: options.definitionsPath })
  );
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

process.on('unhandledRejection', error => {
  // Puppeteer likes to be very verbose when the RPC connection closes, so let's
  // just ignore all of that
  process.exit(0);
});
