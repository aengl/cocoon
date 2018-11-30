import program from 'caporal';
import { spawn } from 'child_process';
import cluster from 'cluster';
import Debug from 'debug';
import fs from 'fs';
import { processNodeById } from './index';

const packageJson = require('../package.json'); // tslint:disable-line
const debug = Debug('core:cli');

function forkAndWatch(file: string) {
  if (!fs.existsSync(file)) {
    throw new Error(`file not found: ${file}`);
  }
  let worker = cluster.fork();
  fs.watchFile(file, { interval: 500 }, () => {
    debug('change detected');
    worker.on('exit', (_0, signal) => {
      debug(`worker was killed by signal: ${signal}`);
    });
    worker.process.kill(); // For some reason, worker.kill() will not work
    worker = cluster.fork();
  });
}

function shell(command: string, args: string[]) {
  const p = spawn(command, args);
  debug(command, args.join(' '));
  return new Promise((resolve, reject) => {
    p.stdout.on('data', data => {
      process.stdout.write(data.toString());
    });
    p.stderr.on('data', data => {
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

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~  ^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: run
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('run', 'Run a Cocoon definition')
  .argument('<yml>', 'Path to the Cocoon definition file')
  .option('-q, --quiet', 'Hide debug output')
  .option('-w, --watch', 'Run in watch mode and respond to file changes')
  .action(async (args, options) => {
    if (!options.quiet) {
      Debug.enable('core:*');
    }
    if (options.root && cluster.isMaster) {
      process.chdir(options.root);
      debug(`changed root to "${options.root}"`);
    }
    if (!args.yml) {
      throw new Error('specify a yml file to run');
    }
    if (options.watch && cluster.isMaster) {
      debug('watch mode enabled, spawning child process');
      forkAndWatch(args.yml);
    } else {
      debug(`running "${args.yml}"`);
      await processNodeById(args.yml);
      debug('done');
    }
    process.exit(0);
  });

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Command: update
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

program
  .command('update', 'Update Cocoon to the latest version')
  .argument('[branch]', 'Use an experimental version on a branch')
  .action(async (args, options) => {
    if (!process.env.DEBUG) {
      Debug.enable('core:*');
    }
    const branch = args.branch || 'master';
    debug(`updating Catirpel to '${branch}'`);
    shell('npm', [
      'install',
      '-g',
      `git+ssh://git@github.com/camyyssa/cocoon2.git#${branch}`,
    ]);
    process.exit(0);
  });

debug(process.argv);
program.parse(process.argv);
