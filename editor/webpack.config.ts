import path from 'path';
import webpack from 'webpack';

export const isDev = Boolean(process.env.DEBUG);

// tslint:disable:object-literal-sort-keys
const config: webpack.Configuration = {
  mode: isDev ? 'development' : 'production',
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
      {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
      },
    ],
  },
  devtool: isDev ? 'inline-source-map' : undefined,
};

export default config;
