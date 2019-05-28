#!/usr/bin/env bash
find common/ core/ editor/ -name '*.js' ! -name 'bin.js' -delete
find common/ core/ editor/ -name '*.map' -delete
rm cocoon-monaco/*.js cocoon-node/*.js
rm cocoon-monaco/*.map cocoon-node/*.map
