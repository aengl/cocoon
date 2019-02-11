#!/usr/bin/env node

/*
 * Entry point for npm's `bin` feature:
 * https://docs.npmjs.com/files/package.json#bin
 *
 * Runs a Python webserver that serves files locally.
 *
 * TODO: it'd be better to not have the Python dependency and use node's
 * webserver instead. Maybe use https://github.com/indexzero/http-server
 */

const concurrently = require('concurrently');
const path = require('path');
const editorPath = path.resolve(__dirname, 'main.js');
const httpServerPath = path.resolve(__dirname, 'ui');
const args = process.argv
  .slice(2)
  .map(x => `"${x}"`)
  .join(' ');
concurrently(
  [
    {
      command: `python3 -m http.server 32901 -d ${httpServerPath}`,
      name: 'webserver',
    },
    {
      command: `node ${editorPath} ${args}`,
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
