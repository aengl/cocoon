#!/usr/bin/env node

/*
 * Entry point for npm's `bin` feature:
 * https://docs.npmjs.com/files/package.json#bin
 */

const spawn = require('child_process').spawn;
spawn('node', ['editor/main.js'], {
  stdio: 'inherit',
  cwd: __dirname,
  detached: true,
});
