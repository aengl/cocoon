#!/usr/bin/env bash
./node_modules/.bin/tsc-watch --onSuccess "./node_modules/.bin/electron editor/main.js tmp/test.yml"
