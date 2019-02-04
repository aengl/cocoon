import program from 'caporal';
import { initialiseBrowser } from './main-browser';
import { initialiseCarlo } from './main-carlo';

program
  .argument('<yml>', 'Path to the Cocoon definition file')
  .option('-c, --carlo', 'Run the editor in Carlo')
  .option('-b, --browser', 'Path to the browser executable')
  .option('--canary', 'Open editor in Google Canary')
  .action(async (args, options) => {
    if (options.carlo) {
      await initialiseCarlo(args.yml);
    } else {
      await initialiseBrowser(
        args.yml,
        options.canary
          ? '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
          : options.browser
      );
    }
  });

program.parse(process.argv);
