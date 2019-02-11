import program from 'caporal';
import { initialiseBrowser } from './main-browser';
import { initialiseCarlo } from './main-carlo';
import { initialise } from './main-common';

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

program.parse(process.argv);
