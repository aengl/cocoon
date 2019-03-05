import { spawn } from 'child_process';

const debug = require('../common/debug')('core:process');

interface RunProcessOptions {
  args?: string[];
  cwd?: string;
}

export function runProcess(command: string, options: RunProcessOptions) {
  const p = spawn(command, options.args, {
    cwd: options.cwd,
    shell: true,
  });
  debug(`running process "${command}"`, options.args);
  return new Promise((resolve, reject) => {
    p.stdout!.on('data', data => {
      process.stdout.write(data.toString());
    });
    p.stderr!.on('data', data => {
      process.stderr.write(data.toString());
    });
    p.on('close', code => {
      debug(`process terminated: "${command}"`);
      code > 0 ? reject(`command returned code ${code}`) : resolve();
    });
  });
}
