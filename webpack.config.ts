// tslint:disable:object-literal-sort-keys
// tslint:disable:no-implicit-dependencies

import _ from 'lodash';
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin';
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
  plugins: [
    new MonacoWebpackPlugin({
      languages: ['yaml'],
    }),
  ],
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
    devServer: {
      contentBase: path.resolve(__dirname, 'editor', 'ui'),
      hot: true,
      port: 32901,
    },
  });
  config.plugins!.push(new HotModuleReplacementPlugin());
  config.module!.rules.push({
    test: /\.js$/,
    use: ['source-map-loader'],
    enforce: 'pre',
    exclude: /monaco-editor/,
  });
}

export default config;
