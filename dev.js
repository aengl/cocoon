#!/usr/bin/env node
const concurrently = require('concurrently');

const commands = [
  {
    command: `npx lerna exec --parallel --stream --scope "@cocoon/@(cocoon|editor|types|util)" -- yarn dev 1>/dev/null`,
    name: 'dev',
  },
  {
    command: `npx lerna exec --parallel --stream --scope "@cocoon/editor" -- yarn dev:editor-ui`,
    name: 'ui',
  },
  {
    command: `sleep 20 && yarn dev:editor`,
    name: 'nodemon',
  },
];

concurrently(commands, {
  raw: true,
  killOthers: ['failure', 'success'],
}).catch(() => {
  process.exit(0);
});
