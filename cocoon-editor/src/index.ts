import { Debug as DebugShared } from '@cocoon/shared/debug';
import {
  initialiseIPC,
  onRequestCocoonUri,
  onRequestMemoryUsage,
  setupLogForwarding,
} from '@cocoon/shared/ipc';
import { ProcessName } from '@cocoon/types';
import program from 'caporal';
import { ChildProcess, exec, spawn } from 'child_process';
import Debug from 'debug';
import open from 'open';
import path from 'path';
import { createEditorURI } from './uri';
const debug = Debug('editor:index');

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

function spawnCocoon() {
  if (state.cocoonProcess) {
    throw new Error(`${ProcessName.Cocoon} is already running`);
  }
  debug(`spawning ${ProcessName.Cocoon}`);
  state.cocoonProcess = spawn(
    'node',
    ['--inspect=9339', path.resolve(__dirname, ProcessName.Cocoon), 'run'],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );
  return state.cocoonProcess;
}

function spawnHttpServer() {
  if (state.httpServerProcess) {
    throw new Error(`${ProcessName.CocoonEditorHTTP} is already running`);
  }
  debug(`spawning ${ProcessName.CocoonEditorHTTP}`);
  state.httpServerProcess = spawn(
    'node',
    ['--inspect=9341', path.resolve(__dirname, ProcessName.CocoonEditorHTTP)],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );
  return state.httpServerProcess;
}

function killCocoonAndHttpServer() {
  // Note that we use impure functions in this module because the process exit
  // handler can only be attached once, so it's easiest to keep module state
  // variables for each process
  if (state.cocoonProcess) {
    debug(`killing ${ProcessName.Cocoon}`);
    state.cocoonProcess.send('close'); // Notify Cocoon process via IPC
  }
  if (state.httpServerProcess) {
    debug(`killing ${ProcessName.CocoonEditorHTTP}`);
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

async function initialise(options: { cocoonUri?: string } = {}) {
  // Initialise Cocoon and IPC
  if (options.cocoonUri) {
    await initialiseIPC(ProcessName.CocoonEditor);
    setupLogForwarding(Debug);
    debug(`using Cocoon instance at "${options.cocoonUri}"`);

    // The editor process will have to proxy the Cocoon URI to the editor, since
    // the editor has no way of knowing what options parameter we passed
    onRequestCocoonUri(() => ({ uri: options.cocoonUri }));
  } else {
    // The Cocoon process will handle all the scheduling and node processing
    const cocoonProcess = spawnCocoon();

    // Wait for IPC and Cocoon process & setup log forwarding
    await Promise.all([
      initialiseIPC(ProcessName.CocoonEditor),
      waitForReadySignal(cocoonProcess),
    ]);
    setupLogForwarding(Debug);
    setupLogForwarding(DebugShared);
    debug(`created local Cocoon instance`);

    // Send an empty response so that the editor will determine the Cocoon URI
    // automatically by falling back to its default value
    onRequestCocoonUri(() => ({}));
  }

  // Send memory usage reports
  onRequestMemoryUsage(() => ({
    memoryUsage: process.memoryUsage(),
    process: ProcessName.CocoonEditor,
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
    Debug.enable('cocoon:*,http:*,editor:*,shared:*');
    spawnHttpServer();
    await initialise({ cocoonUri: options.connect });
    if (!options.headless) {
      await initialiseBrowser({
        browserPath: options.browser || process.env.COCOON_BROWSER_PATH,
        definitionsPath: path.resolve(args.yml),
      });
    }
    process.stdout.write(splash);
  });

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
process.on('exit', killCocoonAndHttpServer);
process.on('SIGHUP', () => process.exit(0));

program.parse(process.argv);
