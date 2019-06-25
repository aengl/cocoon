import program from 'caporal';
import Debug from 'debug';
import { resolvePath } from './fs';
import { initialise, openDefinitions, processNodeById } from './index';

const packageJson = require('../package.json'); // tslint:disable-line
const debug = Debug('core:cli');

process.on('unhandledRejection', error => {
  throw error;
});

program.version(packageJson.version);

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: run
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('run', 'Run a Cocoon processing kernel')
  .argument('[yml]', 'Path to the Cocoon definition file')
  .argument('[node]', 'ID of the node to process')
  .option('-q, --quiet', 'Hide debug output')
  .action(async (args, options) => {
    if (!options.quiet) {
      Debug.enable('core:*,common:*');
    }
    debug('initialising processing kernel');
    await initialise();
    if (args.yml) {
      await openDefinitions(resolvePath(args.yml, { root: process.cwd() }));
      if (args.node) {
        debug(`processing node "${args.node}"`);
        await processNodeById(args.node);
        process.exit(0);
      }
    }
  });

process.title = 'cocoon-core';

// debug(process.argv);
program.parse(process.argv);
