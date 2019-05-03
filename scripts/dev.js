#!/usr/bin/env node

const path = require('path');
const concurrently = require('concurrently');
const httpServerPath = path.resolve(__dirname, '../editor/ui');
concurrently(
  [
    {
      command: `yarn dev:watch 1>/dev/null`,
      name: 'compiler',
    },
    {
      command: `yarn dev:editor`,
      name: 'editor',
    },
    {
      command: `yarn dev:bundle`,
      name: 'webpack',
    },
    {
      command: `python3 -m http.server 32901 -d ${httpServerPath}`,
      name: 'webserver',
    },
  ],
  {
    raw: true,
    killOthers: ['failure', 'success'],
  }
).catch(() => {
  process.exit(0);
});
