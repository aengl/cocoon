// tslint:disable:object-literal-sort-keys

import path from 'path';
import { Configuration } from 'webpack';

const config: Configuration = {
  mode: 'production',
  entry: path.resolve(__dirname, 'core', 'cli.js'),
  target: 'node',
  output: {
    filename: 'cli.js',
    path: path.resolve(__dirname, 'dist', 'core'),
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  performance: {
    hints: false,
  },
};

export default config;
