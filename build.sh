#!/usr/bin/env bash -e
yarn
yarn bootstrap
npx lerna exec --stream --scope "@cocoon/types" -- yarn build
npx lerna exec --parallel --stream --scope "@cocoon/@(docs|ipc|monaco|util)" -- yarn build
npx lerna exec --parallel --stream --scope "@cocoon/@(cocoon|editor|testing|plugin-*)" -- yarn build
