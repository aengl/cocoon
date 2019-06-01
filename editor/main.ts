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

function runInNode(args) {
  const p = spawn('node', args);
  p.stdout.on('data', data => {
    process.stdout.write(data.toString());
  });
  p.stderr.on('data', data => {
    process.stderr.write(data.toString());
  });
  p.on('error', error => {
    throw error;
  });
  p.on('close', () => {
    throw new Error(`process "${args}" closed; terminating`);
  });
  return p;
}

function spawnCoreProcess() {
  debug('spawning core process');
  const coreProcess = spawn(
    'node',
    ['--inspect=9339', path.resolve(__dirname, '../core/cli'), 'run'],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );

  // End core process when exiting
  process.on('exit', () => {
    coreProcess.send('close'); // Notify core process via IPC
    process.exit(0);
  });

  return coreProcess;
}

function spawnHttpServer() {
  debug('spawning http server process');
  const httpServer = spawn(
    'node',
    ['--inspect=9341', path.resolve(__dirname, 'http-server')],
    {
      cwd: path.resolve(__dirname, '..'),
      detached: false,
      stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
    }
  );

  // End http server when exiting
  process.on('exit', () => {
    httpServer.kill();
    process.exit(0);
  });

  return httpServer;
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
  .option('--canary', 'Open editor in Google Canary')
  .option('--headless', 'Run the editor headlessly')
  .action(async (args, options) => {
    Debug.enable('core:*,common:*,main:*');
    spawnHttpServer();
    if (options.headless) {
      await initialise({ coreURI: options.connect });
    } else {
      await initialise({ coreURI: options.connect });
      await initialiseBrowser({
        browserPath: options.canary
          ? '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
          : options.browser,
        definitionsPath: args.yml,
      });
    }
  });

// Enable debug colors in spawned processes
(process.env as any).DEBUG_COLORS = 1;

// Print all warnings in the console
process.on('warning', e => console.warn(e.stack));

program.parse(process.argv);
