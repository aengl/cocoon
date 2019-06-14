import program from 'caporal';
import { ChildProcess, exec, spawn } from 'child_process';
import Debug from 'debug';
import open from 'open';
import path from 'path';
import {
  initialiseIPC,
  onRequestCoreURI,
  onRequestMemoryUsage,
} from '../common/ipc';
import { createEditorURI } from './uri';

const debug = Debug('main:main');

const state: {
  coreProcess: ChildProcess | null;
  httpServerProcess: ChildProcess | null;
} = {
  coreProcess: null,
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

function spawnCoreProcess() {
  if (state.coreProcess) {
    throw new Error(`core process is already running`);
  }
  debug('spawning core process');
  state.coreProcess = spawn(
    'node',
    ['--inspect=9339', path.resolve(__dirname, '../core/cli'), 'run'],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );
  return state.coreProcess;
}

function spawnHttpServer() {
  if (state.httpServerProcess) {
    throw new Error(`http server process is already running`);
  }
  debug('spawning http server process');
  state.httpServerProcess = spawn(
    'node',
    ['--inspect=9341', path.resolve(__dirname, 'http-server')],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );
  return state.httpServerProcess;
}

function killCoreAndServer() {
  // Note that we use impure functions in this module because the process exit
  // handler can only be attached once, so it's easiest to keep module state
  // variables for each process
  if (state.coreProcess) {
    debug('killing core process');
    state.coreProcess.send('close'); // Notify core process via IPC
  }
  if (state.httpServerProcess) {
    debug('killing http server process');
    state.httpServerProcess.kill();
  }
}

async function initialiseBrowser(
  options: {
    definitionsPath?: string;
    browserPath?: string;
  } = {}
) {
  debug('opening browser');
  const uri = createEditorURI('editor.html', {
    file: options.definitionsPath,
  });
  if (options.browserPath) {
    exec(`"${options.browserPath}" "${uri}"`);
  } else {
    open(uri);
  }
}

async function initialise(options: { coreURI?: string } = {}) {
  // Initialise core and IPC
  if (options.coreURI) {
    await initialiseIPC();
    debug(`using remote kernel at "${options.coreURI}"`);

    // The main process will have to proxy the core URI to the editor, since the
    // editor has no way of knowing what options parameter we passed
    onRequestCoreURI(() => ({ uri: options.coreURI }));
  } else {
    // The core process will handle all the scheduling and node processing
    const coreProcess = spawnCoreProcess();

    // Wait for IPC and core process
    await Promise.all([initialiseIPC(), waitForReadySignal(coreProcess)]);
    debug(`created local processing kernel`);

    // Send an empty response so that the editor will determine the core URI
    // automatically by falling back to its default value
    onRequestCoreURI(() => ({}));
  }

  // Send memory usage reports
  onRequestMemoryUsage(() => ({
    memoryUsage: process.memoryUsage(),
    process: 'main',
  }));
}

async function waitForReadySignal(childProcess: ChildProcess) {
  await new Promise(resolve =>
    childProcess.on('message', m => {
      if (m === 'ready') {
        resolve();
      }
    })
  );
}

program
  .argument('[yml]', 'Path to the Cocoon definition file')
  .option(
    '-c, --connect <url>',
    'Connect to an existing Cocoon processing kernel'
  )
  .option('--browser-path <path>', 'Path to the browser executable')
  .option('--headless', 'Run the editor headlessly')
  .action(async (args, options) => {
    Debug.enable('common:*,main:*');
    spawnHttpServer();
    await initialise({ coreURI: options.connect });
    if (!options.headless) {
      await initialiseBrowser({
        browserPath: options.browser || process.env.COCOON_BROWSER_PATH,
        definitionsPath: path.resolve(args.yml),
      });
    }
    process.stdout.write(splash);
  });

process.title = 'cocoon-main';

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
process.on('exit', killCoreAndServer);
process.on('SIGHUP', () => process.exit(0));

program.parse(process.argv);
