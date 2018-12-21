#!/usr/bin/env bash
$COCOONPATH = ${COCOONPATH:="\"~/Resilio Sync/Tibi/Cocoon2/test.yml\""}
echo $COCOONPATH
node editor/main.js $COCOONPATH
