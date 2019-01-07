#!/usr/bin/env node

/*
 * Entry point for npm's `bin` feature:
 * https://docs.npmjs.com/files/package.json#bin
 */

require('debug').enable('core:*,main:*,common:*');
require('./cli');
