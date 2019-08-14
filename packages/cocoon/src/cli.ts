import resolveFilePath from '@cocoon/util/resolveFilePath';
import program from 'commander';
import Debug from 'debug';
import { PackageJson } from 'type-fest';
import { createNode, createProject, createView } from './create';
import {
  initialise,
  openCocoonFile,
  processAllNodes,
  processNodeById,
} from './index';

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
 * Command: create
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('create <name>')
  .description(
    'Creates new nodes/views for the project in the current directory'
  )
  .option('-v, --view', 'Creates a new view')
  .option('-t, --typescript', 'Create the node/view in TypeScript')
  .action(async (name, options) => {
    if (options.view) {
      await createView(name, {
        typescript: options.typescript || false,
      });
    } else {
      await createNode(name, {
        typescript: options.typescript || false,
      });
    }
  });

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: init
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('init <folder>')
  .description('Creates new Cocoon project')
  .option('-y, --yarn', 'Use yarn instead of npm')
  .action(async (folder, options) => {
    await createProject(folder, {
      version: packageJson.version,
      yarn: options.yarn || false,
    });
  });

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
