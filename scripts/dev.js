#!/usr/bin/env node

const concurrently = require('concurrently');
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
      command: `yarn dev:server`,
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
