#!/usr/bin/env bash
$COCOONPATH = ${COCOONPATH:="~/Resilio Sync/Tibi/Cocoon2/test.yml"}
echo $COCOONPATH
node --inspect=9340 editor/main.js "$COCOONPATH"
