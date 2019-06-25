// tslint:disable:object-literal-sort-keys

import path from 'path';
import { Configuration } from 'webpack';

const config: Configuration = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src', 'http-server.js'),
  target: 'node',
  output: {
    filename: 'http-server.js',
    path: path.resolve(__dirname, 'dist'),
  },
  // Leave __dirname intact
  node: {
    __dirname: false,
    __filename: false,
  },
};

export default config;
