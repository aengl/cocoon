#!/usr/bin/env node

const concurrently = require('concurrently');

concurrently(
  [
    {
      command: `yarn dev:build 1>/dev/null`,
      name: 'compiler',
    },
    {
      command: `yarn dev:bundle`,
      name: 'webpack',
    },
    {
      command: `yarn dev:editor`,
      name: 'editor',
    },
    {
      command: `yarn dev:serve`,
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
