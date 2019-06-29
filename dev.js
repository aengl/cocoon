#!/usr/bin/env node

const concurrently = require('concurrently');

concurrently(
  [
    {
      command: `npx lerna exec --stream --scope "@cocoon/@(cocoon|editor|shared|types)" -- yarn dev 1>/dev/null`,
      name: 'dev',
    },
    {
      command: `npx lerna exec --stream --scope "@cocoon/editor" -- yarn dev:editor-ui`,
      name: 'ui',
    },
    {
      command: `npx lerna exec --stream --scope "@cocoon/plugin-*" -- yarn dev:ncc`,
      name: 'plugins/nodes',
    },
    {
      command: `npx lerna exec --stream --scope "@cocoon/plugin-*" -- yarn dev:rollup`,
      name: 'plugins/components',
    },
    {
      command: `sleep 20 && yarn dev:editor`,
      name: 'nodemon',
    },
  ],
  {
    raw: true,
    killOthers: ['failure', 'success'],
  }
).catch(() => {
  process.exit(0);
});
