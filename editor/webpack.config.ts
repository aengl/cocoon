import path from 'path';
import webpack from 'webpack';

// tslint:disable:object-literal-sort-keys
const config: webpack.Configuration = {
  mode: 'development',
  entry: './renderer/index.tsx',
  target: 'electron-renderer',
  output: {
    filename: 'bundle.js',
    path: path.resolve('renderer'),
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
    ],
  },
  devtool: 'inline-source-map',
};

export default config;
