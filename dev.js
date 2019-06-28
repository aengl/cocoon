#!/usr/bin/env node

const concurrently = require('concurrently');

concurrently([
  {
    command: `cd cocoon && npm run compile`,
    name: 'build cocoon',
  },
  {
    command: `cd cocoon-editor && npm run compile`,
    name: 'build editor',
  },
  {
    command: `cd cocoon-types && npm run compile`,
    name: 'build types',
  },
  {
    command: `cd cocoon-shared && npm run compile`,
    name: 'build shared',
  },
]).then(() => {
  concurrently(
    [
      {
        command: `cd cocoon && npm run dev 1>/dev/null`,
        name: 'cocoon',
      },
      {
        command: `cd cocoon-editor && npm run dev 1>/dev/null`,
        name: 'editor',
      },
      {
        command: `cd cocoon-types && npm run dev 1>/dev/null`,
        name: 'types',
      },
      {
        command: `cd cocoon-shared && npm run dev 1>/dev/null`,
        name: 'shared',
      },
      {
        command: `cd plugins && npm run dev 1>/dev/null`,
        name: 'plugins',
      },
      {
        command: `cd cocoon-editor && npm run dev:editor-ui`,
        name: 'editor-ui',
      },
      {
        command: `npm run dev:editor`,
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
});
