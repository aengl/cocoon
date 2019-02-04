#!/usr/bin/env node

const concurrently = require('concurrently');
const path = process.argv[2] || '~/Resilio Sync/Tibi/Cocoon2/test.yml';
concurrently(
  [
    {
      command: `tsc --watch 1>/dev/null`,
      name: 'compiler',
    },
    {
      command: `DEBUG=1 node --inspect=9340 editor/main.js --canary "${path}"`,
      name: 'editor',
    },
    {
      command: `DEBUG=1 webpack-dev-server`,
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
