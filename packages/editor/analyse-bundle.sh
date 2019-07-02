#!/usr/bin/env bash
npx webpack --config webpack.ui.js --profile --json > stats.json
npx webpack-bundle-analyzer stats.json dist/ui
