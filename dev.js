#!/usr/bin/env node

const concurrently = require('concurrently');

concurrently([
  {
    command: `cd cocoon && yarn compile`,
    name: 'cocoon',
  },
  {
    command: `cd cocoon-editor && yarn compile`,
    name: 'cocoon',
  },
  {
    command: `cd cocoon-types && yarn compile`,
    name: 'cocoon',
  },
  {
    command: `cd cocoon-shared && yarn compile`,
    name: 'cocoon',
  },
]).then(() => {
  concurrently(
    [
      {
        command: `cd cocoon && yarn dev 1>/dev/null`,
        name: 'cocoon',
      },
      {
        command: `cd cocoon-editor && yarn dev 1>/dev/null`,
        name: 'cocoon-editor',
      },
      {
        command: `cd cocoon-types && yarn dev 1>/dev/null`,
        name: 'cocoon-types',
      },
      {
        command: `cd cocoon-shared && yarn dev 1>/dev/null`,
        name: 'cocoon-shared',
      },
      {
        command: `cd cocoon-editor && yarn dev:editor-ui`,
        name: 'cocoon-editor-ui',
      },
      {
        command: `yarn dev:editor`,
        name: 'cocoon-editor',
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
