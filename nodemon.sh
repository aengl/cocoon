#!/usr/bin/env bash
DEBUG=cocoon:*,editor:*,http:*,ui:* nodemon \
  --verbose \
  --inspect=9340 \
  --ext js \
  --watch packages/cocoon/ \
  --watch packages/editor/src/ \
  --ignore packages/editor/src/ui/ \
  --watch packages/types/ \
  --watch packages/util/ \
  --signal SIGHUP packages/editor/src/cocoon-editor.js \
  -- --headless
