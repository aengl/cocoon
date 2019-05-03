#!/usr/bin/env bash
tsc
npx dts-bundle-generator --no-check build.ts -o index.d.ts
npx ncc build -S -o . index.js
