import _ from 'lodash';
import path from 'path';
import webpack from 'webpack';

export const isDev = Boolean(process.env.DEBUG);

// tslint:disable:object-literal-sort-keys
const config: webpack.Configuration = {
  mode: 'production',
  entry: './editor/ui/index.tsx',
  target: 'electron-renderer',
  output: {
    filename: './editor/ui/bundle.js',
    path: path.resolve('ui'),
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

const devConfig: webpack.Configuration = {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    contentBase: path.resolve('/editor/ui'),
  },
};

export default (isDev ? _.merge(config, devConfig) : config);
