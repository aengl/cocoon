#!/usr/bin/env bash
npx webpack --config webpack.editor.dev.js --profile --json > stats.json
npx webpack-bundle-analyzer stats.json ./editor/ui
