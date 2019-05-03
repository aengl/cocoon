#!/usr/bin/env node

/*
 * Entry point for npm's `bin` feature:
 * https://docs.npmjs.com/files/package.json#bin
 */

const concurrently = require('concurrently');
const path = require('path');

const editor = path.resolve(__dirname, 'main.js');
const httpServer = path.resolve(__dirname, 'http-server.js');
const args = process.argv
  .slice(2)
  .map(x => `"${x}"`)
  .join(' ');

concurrently(
  [
    {
      command: `node ${httpServer}`,
      name: 'http-server',
    },
    {
      command: `node ${editor} ${args}`,
      name: 'editor',
    },
  ],
  {
    raw: true,
    killOthers: ['failure', 'success'],
  }
).catch(() => {
  process.exit(0);
});
