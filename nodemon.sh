#!/usr/bin/env bash
DEBUG=cocoon:*,editor:*,http:*,shared:*,ui:* nodemon \
  --verbose \
  --inspect=9340 \
  --ext js \
  --watch packages/cocoon/ \
  --watch packages/editor/src/ \
  --ignore packages/editor/src/ui/ \
  --watch packages/shared/ \
  --watch packages/types/ \
  --signal SIGHUP packages/editor/src/index.js \
  -- --headless
