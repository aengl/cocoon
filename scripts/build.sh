#!/usr/bin/env bash

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
cp scripts/bin.sh dist
chmod +x dist/bin.sh
