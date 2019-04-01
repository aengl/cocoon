#!/usr/bin/env node

const concurrently = require('concurrently');
concurrently(
  [
    {
      command: `tsc --watch 1>/dev/null`,
      name: 'compiler',
    },
    {
      command: `DEBUG=1 nodemon --inspect=9340 editor/main.js -- --headless`,
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
