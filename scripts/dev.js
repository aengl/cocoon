#!/usr/bin/env node

require('debug').enable('core:*,main:*,common:*');
const concurrently = require('concurrently');
const path = process.argv[2] || '~/Resilio Sync/Tibi/Cocoon2/test.yml';
concurrently(
  [
    {
      command: `tsc --watch 1>/dev/null`,
      name: 'compiler',
    },
    {
      command: `node --inspect=9340 -r esm editor/main.js "${path}"`,
      name: 'editor',
    },
    {
      command: `webpack-dev-server`,
      name: 'webpack',
    },
  ],
  {
    raw: true,
    killOthers: ['failure', 'success'],
  }
).catch(() => {
  process.exit(0);
});
