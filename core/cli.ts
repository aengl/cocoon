import program from 'caporal';
import { spawn } from 'child_process';
import Debug from 'debug';
import { resolvePath } from './fs';
import { openDefinitions, processNodeById, initialise } from './index';

const packageJson = require('../package.json'); // tslint:disable-line
const debug = Debug('core:cli');

function shell(command: string, args: string[]) {
  const p = spawn(command, args);
  debug(command, args.join(' '));
  return new Promise((resolve, reject) => {
    p.stdout!.on('data', data => {
      process.stdout.write(data.toString());
    });
    p.stderr!.on('data', data => {
      process.stderr.write(data.toString());
    });
    p.on('close', code => {
      code > 0 ? reject(`command returned code ${code}`) : resolve();
    });
  });
}

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

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: update
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('update', 'Update Cocoon to the latest version')
  .argument('[branch]', 'Use an experimental version on a branch')
  .action(async (args, options) => {
    const branch = args.branch || 'master';
    console.log(`updating Catirpel to '${branch}'`);
    shell('npm', [
      'install',
      '-g',
      `git+ssh://git@github.com/camyyssa/cocoon2.git#${branch}`,
    ]);
    process.exit(0);
  });

// debug(process.argv);
program.parse(process.argv);
