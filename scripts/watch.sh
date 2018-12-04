#!/usr/bin/env bash
$COCOONPATH = ${COCOONPATH:="\"~/Resilio Sync/Tibi/Cocoon2/test.yml\""}
echo $COCOONPATH
./node_modules/.bin/tsc-watch --onSuccess "./node_modules/.bin/electron editor/main.js $COCOONPATH"
