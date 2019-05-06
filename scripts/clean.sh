#!/usr/bin/env bash
find common/ core/ editor/ -name '*.js' ! -name 'bin.js' ! -name 'dev.js' ! -name 'http-server.js' -delete
find common/ core/ editor/ -name '*.map' -delete
