#!/usr/bin/env bash -e
yarn
yarn bootstrap
npx lerna run build --scope "@cocoon/types" $1
npx lerna run build --scope "@cocoon/util" $1
npx lerna run build --scope "@cocoon/cocoon" $1
npx lerna run build --scope "@cocoon/monaco" $1
npx lerna run build --scope "@cocoon/testing" $1
npx lerna run build --scope "@cocoon/@(plugin-*)" $1
npx lerna run build --scope "@cocoon/editor" $1
npx lerna run build --scope "@cocoon/docs" $1
