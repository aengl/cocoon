// tslint:disable:object-literal-sort-keys

import path from 'path';
import { BannerPlugin, Configuration } from 'webpack';

const config: Configuration = {
  mode: 'production',
  entry: path.resolve(__dirname, 'editor', 'main.js'),
  target: 'node',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist', 'editor'),
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  performance: {
    hints: false,
  },
  // Leave __dirname intact
  node: {
    __dirname: false,
    __filename: false,
  },
  plugins: [new BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })],
};

export default config;
