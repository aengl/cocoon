import resolveFilePath from '@cocoon/util/resolveFilePath';
import program from 'commander';
import Debug from 'debug';
import { PackageJson } from 'type-fest';
import {
  initialise,
  openCocoonFile,
  processAllNodes,
  processNodeById,
} from './index';
import { createNode } from './create';

const packageJson: PackageJson = require('../package.json');
const debug = Debug('cocoon:cli');

process.on('unhandledRejection', error => {
  throw error;
});

program.version(packageJson.version || 'unknown');

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: run
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('run')
  .description('Run a Cocoon processing kernel')
  .option('-a, --all', 'Process all nodes')
  .option('-f, --file <file>', 'Cocoon file to open')
  .option('-n, --node <nodeId>', 'ID of a node to process automatically')
  .option('-q, --quiet', 'Hide debug output')
  .action(async options => {
    if (!options.quiet) {
      Debug.enable('cocoon:*');
    }
    debug('initialising processing kernel');
    await initialise();
    if (options.file) {
      await openCocoonFile(resolveFilePath(options.file));
      if (options.all) {
        debug(`processing all nodes`);
        await processAllNodes();
        process.exit(0);
      } else if (options.node) {
        debug(`processing node "${options.node}"`);
        await processNodeById(options.node);
        process.exit(0);
      }
    }
  });

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: run
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('create <name>')
  .description(
    'Creates new nodes/views for the project in the current directory'
  )
  .option('-V, --view', 'Creates a new view')
  .option('-t, --typescript', 'Create the node/view in TypeScript')
  .action(async (name, options) => {
    if (options.view) {
    } else {
      await createNode(name, {
        typescript: options.typescript || false,
      });
    }
  });

program.parse(process.argv);
