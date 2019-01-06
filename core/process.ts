import { spawn } from 'child_process';

const debug = require('debug')('common:process');

export function runProcess(command: string, args: string[]) {
  const p = spawn(command, args, {
    shell: true,
  });
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
