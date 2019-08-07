#!/usr/bin/env bash -e
yarn
yarn bootstrap
npx lerna exec --scope "@cocoon/types" -- yarn build
npx lerna exec --scope "@cocoon/util" -- yarn build
npx lerna exec --scope "@cocoon/cocoon" -- yarn build
npx lerna exec --scope "@cocoon/monaco" -- yarn build
npx lerna exec --scope "@cocoon/testing" -- yarn build
npx lerna exec --scope "@cocoon/@(plugin-*)" -- yarn build
npx lerna exec --scope "@cocoon/editor" -- yarn build
npx lerna exec --scope "@cocoon/docs" -- yarn build
