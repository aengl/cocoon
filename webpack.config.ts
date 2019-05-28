// tslint:disable:object-literal-sort-keys

import _ from 'lodash';
import path from 'path';
import { Configuration } from 'webpack';

export const isDev = Boolean(process.env.DEBUG);

const config: Configuration = {
  mode: isDev ? 'development' : 'production',
  entry: './editor/ui/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'editor', 'ui'),
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

if (isDev) {
  _.assign(config, {
    mode: 'development',
    devtool: 'inline-source-map',
  });
  config.module!.rules.push({
    test: /\.js$/,
    use: ['source-map-loader'],
    enforce: 'pre',
    exclude: /node_modules/,
  });
}

export default config;
