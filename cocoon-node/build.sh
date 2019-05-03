#!/usr/bin/env bash
tsc
npx dts-bundle-generator --no-check index.ts
npx ncc build -S -o . index.js
