// tslint:disable:object-literal-sort-keys
// tslint:disable:no-implicit-dependencies

import _ from 'lodash';
import path from 'path';
import { Configuration } from 'webpack';
import { Configuration as DevConfiguration } from 'webpack-dev-server';

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
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
      },
    ],
  },
  performance: {
    hints: false,
  },
};

if (isDev) {
  const devServerConfig: DevConfiguration = {
    contentBase: path.resolve(__dirname, 'editor', 'ui'),
    // hot: true,
    port: 32901,
  };
  const devConfig: Configuration = {
    mode: 'development',
    devtool: 'inline-source-map',
    // plugins: [new HotModuleReplacementPlugin()],
  };
  _.set(devConfig, 'devServer', devServerConfig);
  _.merge(config, devConfig);
}

export default config;
