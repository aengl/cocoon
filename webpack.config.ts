// tslint:disable:object-literal-sort-keys

import _ from 'lodash';
import path from 'path';
import { Configuration } from 'webpack';
import { Configuration as DevConfiguration } from 'webpack-dev-server';

export const isDev = Boolean(process.env.DEBUG);

const config: Configuration = {
  mode: 'production',
  entry: './editor/ui/index.tsx',
  target: 'electron-renderer',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'editor', 'ui'),
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: {
      ws: 'isomorphic-ws',
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: { transpileOnly: true },
      },
      {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
      },
    ],
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
