#!/usr/bin/env bash
DEBUG=cocoon:*,editor:*,http:*,ui:* nodemon \
  --verbose \
  --inspect=9340 \
  --ext js \
  --watch packages/cocoon/src/ \
  --watch packages/editor/dist/ \
  --watch packages/types/ \
  --watch packages/util/ \
  --signal SIGHUP packages/editor/dist/cocoon-editor.js \
  -- --headless
