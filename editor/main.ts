import program from 'caporal';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import { initialiseBrowser } from './main-browser';
import { initialiseCarlo } from './main-carlo';
import { initialise } from './main-common';

let httpProcess: ChildProcessWithoutNullStreams;

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

program
  .argument('[yml]', 'Path to the Cocoon definition file')
  .option(
    '-c, --connect <url>',
    'Connect to an existing Cocoon processing kernel'
  )
  .option('--carlo', 'Run the editor in Carlo')
  .option('--browser-path <path>', 'Path to the browser executable')
  .option('--canary', 'Open editor in Google Canary')
  .option('--headless', 'Run the editor headlessly')
  .action(async (args, options) => {
    httpProcess = runInNode([path.resolve(__dirname, 'http-server')]);
    if (options.carlo) {
      await initialiseCarlo(args.yml);
    } else if (options.headless) {
      await initialise({ coreURI: options.connect });
    } else {
      await initialiseBrowser({
        browserPath: options.canary
          ? '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
          : options.browser,
        coreURI: options.connect,
        definitionsPath: args.yml,
      });
    }
  });

(process.env as any).DEBUG_COLORS = 1;
process.on('exit', () => {
  if (httpProcess) {
    httpProcess.kill();
  }
});

program.parse(process.argv);
