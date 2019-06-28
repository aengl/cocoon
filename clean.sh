#!/usr/bin/env bash

# Remove build artifacts
find cocoon/ cocoon-editor/ cocoon-monaco/ cocoon-shared/ cocoon-testing/ -name '*.js' -delete
find cocoon/ cocoon-editor/ cocoon-monaco/ cocoon-shared/ cocoon-testing/ -name '*.d.ts' -delete
find . -name '*.map' -delete
find . -name '*.tsbuildinfo' -delete

# Remove node module folders & lock files
npx lerna clean -y
find . -name 'package-lock.json' -delete

# Remove build/dist folders
find . -type d -name build -exec rm -rf {} \;
find . -type d -name dist -exec rm -rf {} \;
