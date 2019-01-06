import program from 'caporal';
import { initialiseBrowser } from './main-browser';
import { initialiseCarlo } from './main-carlo';

program
  .argument('[yml]', 'Path to the Cocoon definition file')
  .option('-b, --browser', 'Run the editor in the browser')
  .action(async (args, options) => {
    if (options.browser) {
      await initialiseBrowser(args.yml);
    } else {
      await initialiseCarlo(args.yml);
    }
  });

program.parse(process.argv);
