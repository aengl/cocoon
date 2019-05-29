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

# Copy run-script
cp scripts/cli.sh scripts/editor.sh dist/
