import carlo from 'carlo';
import { initialise } from './main-common';
import { createURI } from './uri';

const packageJson = require('../package.json');

process.on('unhandledRejection', error => {
  // Puppeteer likes to be very verbose when the RPC connection closes, so let's
  // just ignore all of that
  process.exit(0);
});

export async function initialiseCarlo(
  options: {
    coreURI?: string;
    definitionsPath?: string;
  } = {}
) {
  const [app, _0] = await Promise.all([launchCarlo(), initialise(options)]);
  await app.load(createURI('editor.html', { file: options.definitionsPath }));
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
