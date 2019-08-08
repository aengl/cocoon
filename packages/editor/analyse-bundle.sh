#!/usr/bin/env bash
npx webpack --profile --json > stats.json
npx webpack-bundle-analyzer stats.json dist/ui
