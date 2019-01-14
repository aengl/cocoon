import { spawn } from 'child_process';

const debug = require('../common/debug')('core:process');

export function runProcess(command: string, args?: string[]) {
  const p = spawn(command, args, {
    shell: true,
  });
  debug(`running process "${command}"`, args);
  return new Promise((resolve, reject) => {
    p.stdout.on('data', data => {
      process.stdout.write(data.toString());
    });
    p.stderr.on('data', data => {
      process.stderr.write(data.toString());
    });
    p.on('close', code => {
      debug(`process terminated: "${command}"`);
      code > 0 ? reject(`command returned code ${code}`) : resolve();
    });
  });
}
