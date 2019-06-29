#!/usr/bin/env bash -e
yarn
yarn bootstrap
npx lerna exec --stream --scope "@cocoon/types" -- yarn build
npx lerna exec --stream --scope "@cocoon/shared" -- yarn build
npx lerna exec --stream --scope "@cocoon/@(cocoon|monaco)" -- yarn build
npx lerna exec --stream --scope "@cocoon/@(editor|testing|plugin-*)" -- yarn build
