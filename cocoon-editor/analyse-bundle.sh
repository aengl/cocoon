#!/usr/bin/env bash
npx webpack --config webpack.ui.dev.js --profile --json > stats.json
npx webpack-bundle-analyzer stats.json ./src/ui
