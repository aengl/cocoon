import program from 'caporal';
import { initialiseBrowser } from './main-browser';
import { initialiseCarlo } from './main-carlo';

program
  .argument('<yml>', 'Path to the Cocoon definition file')
  .option('-c, --carlo', 'Run the editor in Carlo')
  .action(async (args, options) => {
    if (options.carlo) {
      await initialiseCarlo(args.yml);
    } else {
      await initialiseBrowser(args.yml);
    }
  });

program.parse(process.argv);
