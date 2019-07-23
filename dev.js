#!/usr/bin/env node
const concurrently = require('concurrently');

const commands = [
  {
    command: `npx lerna exec --parallel --stream --scope "@cocoon/@(cocoon|ipc|editor|types|util)" -- yarn dev 1>/dev/null`,
    name: 'dev',
  },
  {
    command: `npx lerna exec --parallel --stream --scope "@cocoon/editor" -- yarn dev:editor-ui`,
    name: 'ui',
  },
  {
    command: `sleep 15 && yarn dev:editor`,
    name: 'nodemon',
  },
];

if (process.argv[2] === '--with-plugins') {
  [
    {
      command: `sleep 30 && npx lerna exec --parallel --stream --scope "@cocoon/plugin-*" -- yarn dev:ncc`,
      name: 'plugins/nodes',
    },
    {
      command: `sleep 30 && npx lerna exec --parallel --stream --scope "@cocoon/plugin-*" -- yarn dev:rollup`,
      name: 'plugins/components',
    },
  ].forEach(x => commands.push(x));
}

concurrently(commands, {
  raw: true,
  killOthers: ['failure', 'success'],
}).catch(() => {
  process.exit(0);
});
