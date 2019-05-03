#!/usr/bin/env node

const concurrently = require('concurrently');
const path = require('path');

const httpServer = path.resolve(__dirname, 'http-server.js');

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
      command: `node ${httpServer}`,
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
