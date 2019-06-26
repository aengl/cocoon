#!/usr/bin/env bash

# Remove build artefacts
find cocoon/ cocoon-editor/ cocoon-monaco/ cocoon-shared/ cocoon-testing/ -name '*.js' -delete
find cocoon/ cocoon-editor/ cocoon-monaco/ cocoon-shared/ cocoon-testing/ -name '*.d.ts' -delete
find . -name '*.map' -delete
find . -name '*.tsbuildinfo' -delete

# Remove node module folders
find . -type d -name node_modules -exec rm -rf {} \;

# Remove dist folders
find . -type d -name dist -exec rm -rf {} \;
