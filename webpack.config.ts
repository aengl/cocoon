// tslint:disable:object-literal-sort-keys
// tslint:disable:no-implicit-dependencies

import _ from 'lodash';
import path from 'path';
import { Configuration, HotModuleReplacementPlugin } from 'webpack';

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
      ws: 'isomorphic-ws',
    },
  },
  performance: {
    hints: false,
  },
};

if (isDev) {
  const devConfig: Configuration = {
    mode: 'development',
    devtool: 'inline-source-map',
    plugins: [new HotModuleReplacementPlugin()],
    module: {
      rules: [
        {
          test: /\.js$/,
          use: ['source-map-loader'],
          enforce: 'pre',
        },
      ],
    },
    devServer: {
      contentBase: path.resolve(__dirname, 'editor', 'ui'),
      hot: true,
      port: 32901,
    },
  };
  _.merge(config, devConfig);
}

export default config;
