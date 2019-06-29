#!/usr/bin/env bash

# Remove build artifacts
find packages/cocoon/ packages/editor/ packages/monaco/ packages/shared/ packages/testing/ -name '*.js' -delete
find packages/cocoon/ packages/editor/ packages/monaco/ packages/shared/ packages/testing/ -name '*.d.ts' -delete
find . -name '*.map' -delete
find . -name '*.tsbuildinfo' -delete

# Remove node module folders & lock files
find . -type d -name node_modules -exec rm -rf {} \;
find . -name 'yarn.lock' -delete

# Remove build/dist folders
find . -type d -name build -exec rm -rf {} \;
find . -type d -name dist -exec rm -rf {} \;
