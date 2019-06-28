#!/usr/bin/env node

const concurrently = require('concurrently');

concurrently([
  {
    command: `cd cocoon && yarn compile`,
    name: 'build cocoon',
  },
  {
    command: `cd cocoon-editor && yarn compile`,
    name: 'build editor',
  },
  {
    command: `cd cocoon-types && yarn compile`,
    name: 'build types',
  },
  {
    command: `cd cocoon-shared && yarn compile`,
    name: 'build shared',
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
        name: 'editor',
      },
      {
        command: `cd cocoon-types && yarn dev 1>/dev/null`,
        name: 'types',
      },
      {
        command: `cd cocoon-shared && yarn dev 1>/dev/null`,
        name: 'shared',
      },
      {
        command: `cd plugins && yarn dev 1>/dev/null`,
        name: 'plugins',
      },
      {
        command: `cd cocoon-editor && yarn dev:editor-ui`,
        name: 'editor-ui',
      },
      {
        command: `yarn dev:editor`,
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
