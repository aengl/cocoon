// tslint:disable:object-literal-sort-keys

import path from 'path';
import { Configuration } from 'webpack';

const config: Configuration = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src', 'ui', 'index.js'),
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist', 'ui'),
  },
  resolve: {
    extensions: ['.js', '.json'],
    alias: {
      // The websocket import is shared in a common library, so we need to remap
      // it to a API-compatible variant for the browser
      ws: 'isomorphic-ws',
    },
  },
  performance: {
    hints: false,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
};

export default config;
