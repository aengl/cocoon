#!/usr/bin/env bash
tsc --skipLibCheck --allowSyntheticDefaultImports index.ts
npx dts-bundle-generator --no-check index.ts
npx ncc build -S -o . index.js
