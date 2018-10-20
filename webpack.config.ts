// tslint:disable:object-literal-sort-keys

import _ from 'lodash';
import path from 'path';
import { Configuration } from 'webpack';

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
  const devConfig: Configuration = {
    mode: 'development',
    devtool: 'inline-source-map',
    devServer: {
      contentBase: path.resolve(__dirname, 'editor', 'ui'),
      // hot: true,
    },
    // plugins: [new HotModuleReplacementPlugin()],
  };
  _.merge(config, devConfig);
}

export default config;
