#!/usr/bin/env node

/*
 * Entry point for npm's `bin` feature:
 * https://docs.npmjs.com/files/package.json#bin
 */

const concurrently = require('concurrently');

const args = process.argv
  .slice(2)
  .map(x => `"${x}"`)
  .join(' ');

concurrently(
  [
    {
      command: `yarn start ${args}`,
      name: 'editor',
    },
    {
      command: `yarn start:serve`,
      name: 'http-server',
    },
  ],
  {
    raw: true,
    killOthers: ['failure', 'success'],
  }
).catch(() => {
  process.exit(0);
});
