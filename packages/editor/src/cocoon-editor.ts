import * as cocoon from '@cocoon/cocoon';
import createServer from '@cocoon/util/ipc/createServer';
import { onRequestCocoonUri } from '@cocoon/util/ipc/requestCocoonUri';
import { ChildProcess, exec, spawn } from 'child_process';
import program from 'commander';
import Debug from 'debug';
import open from 'open';
import path from 'path';
import { PackageJson } from 'type-fest';
import WebSocket from 'ws';
import { createEditorURI } from './uri';

const packageJson: PackageJson = require('../package.json');
const debug = Debug('editor:index');
const httpServerName = 'cocoon-editor-http';

const state: {
  cocoonProcess: ChildProcess | null;
  httpServerProcess: ChildProcess | null;
} = {
  cocoonProcess: null,
  httpServerProcess: null,
};

const splash = `
               ██████
               ██████████
                 ██████████
                 ████████████
               ████████████████
             ██████░░░░░░██████
           ██░░░░░░░░██░░░░░░░░██
         ██████████░░░░░░████████
       ██████████████████████████████
           ▓▓▓▓    ▓▓▓▓▓▓    ▓▓▓▓
         ▓▓▓▓  ████  ▓▓  ████  ▓▓▓▓
         ▓▓▓▓  ████  ▓▓  ████  ▓▓▓▓
         ▓▓▓▓▓▓    ░░░░      ▓▓▓▓▓▓
         ▓▓▓▓▓▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓
       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
     ▓▓▓▓▓▓▓▓▓▓▓▓          ▓▓▓▓▓▓▓▓▓▓▓▓
     ▓▓▓▓▓▓▓▓▓▓              ▓▓▓▓▓▓▓▓▓▓
         ▓▓▓▓                  ▓▓▓▓
         ▓▓▓▓                  ▓▓▓▓
           ▓▓                  ▓▓
             ▓▓              ▓▓
               ▓▓          ▓▓
                 ░░      ░░
               ░░░░      ░░░░

  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  ▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▓
  ▓░  Welcome to Cocoon -- open this URL: ░▓
  ▓░  http://127.0.0.1:22242/editor.html  ░▓
  ▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▓
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

`;

function spawnHttpServer() {
  if (state.httpServerProcess) {
    throw new Error(`${httpServerName} is already running`);
  }
  debug(`spawning ${httpServerName}`);
  state.httpServerProcess = spawn(
    'node',
    ['--inspect=9341', path.resolve(__dirname, `${httpServerName}.js`)],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );
  return state.httpServerProcess;
}

function killHttpServer() {
  // Note that we use impure functions in this module because the process exit
  // handler can only be attached once, so it's easiest to keep module state
  // variables for each process
  if (state.httpServerProcess) {
    debug(`killing ${httpServerName}`);
    state.httpServerProcess.kill();
  }
}

async function initialiseBrowser(
  options: {
    cocoonFilePath?: string;
    browserPath?: string;
  } = {}
) {
  debug('opening browser');
  const uri = createEditorURI('editor.html', {
    file: options.cocoonFilePath,
  });
  if (options.browserPath) {
    exec(`"${options.browserPath}" "${uri}"`);
  } else {
    open(uri);
  }
}

async function initialise(options: { cocoonUri?: string } = {}) {
  // Initialise Cocoon and IPC
  const boundCreateServer = createServer.bind(
    null,
    WebSocket as any,
    22245,
    Debug('editor:ipc')
  );
  if (options.cocoonUri) {
    const server = await boundCreateServer();
    debug(`using Cocoon instance at "${options.cocoonUri}"`);

    // The editor process will have to proxy the Cocoon URI to the editor, since
    // the editor has no way of knowing what options parameter we passed
    onRequestCocoonUri(server, () => ({ uri: options.cocoonUri }));
  } else {
    // Wait for IPC and Cocoon & setup log forwarding
    const [_0, server] = await Promise.all([
      cocoon.initialise(),
      await boundCreateServer(),
    ]);
    debug(`created local Cocoon instance`);

    // Send an empty response so that the editor will determine the Cocoon URI
    // automatically by falling back to its default value
    onRequestCocoonUri(server, () => ({}));
  }
}

program
  .version(packageJson.version || 'unknown')
  .description('Runs the Cocoon editor')
  .arguments('[yml]')
  .option(
    '-c, --connect <url>',
    'Connect to an existing Cocoon processing kernel'
  )
  .option('--browser-path <path>', 'Path to the browser executable')
  .option('--headless', 'Run the editor headlessly')
  .action(async (yml, options) => {
    Debug.enable('cocoon:*,editor:*,http:*');
    spawnHttpServer();
    await initialise({ cocoonUri: options.connect });
    if (!options.headless) {
      await initialiseBrowser({
        browserPath: options.browser || process.env.COCOON_BROWSER_PATH,
        cocoonFilePath: yml ? path.resolve(yml) : yml,
      });
    }
    process.stdout.write(splash);
  });

process.title = __filename;

// Enable debug colors in spawned processes
(process.env as any).DEBUG_COLORS = 1;

// Print all warnings in the console
process.on('warning', e => {
  if (e.stack) {
    process.stderr.write(e.stack);
  }
});

// End all child processes when exiting (we handle SIGHUP specifically to
// gracefully restart the processes via nodemon)
process.on('exit', killHttpServer);
process.on('SIGHUP', () => process.exit(0));

program.parse(process.argv);
