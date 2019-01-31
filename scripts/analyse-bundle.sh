#!/usr/bin/env bash
webpack --profile --json > stats.json
webpack-bundle-analyzer stats.json
