#!/usr/bin/env bash

# Remove previous build
rm -rf dist/

# Compile TS
yarn build:tsc

# Build core
yarn build:core

# Build editor
yarn build:main
yarn build:editor
yarn build:http
yarn build:cocoon-monaco
cp editor/ui/*.html editor/ui/*.png dist/editor/ui/

# Make entry scripts executable
chmod +x dist/core/cli.js dist/editor/main.js
