#!/usr/bin/env bash
find common/ cocoon-monaco/ cocoon-node/ core/ editor/ -name '*.js' ! -name 'bin.js' ! -name 'dev.js' -delete
find common/ core/ editor/ -name '*.map' -delete
