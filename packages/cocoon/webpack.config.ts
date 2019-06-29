// tslint:disable:object-literal-sort-keys
import { ProcessName } from '@cocoon/types';
import path from 'path';
import { BannerPlugin, Configuration } from 'webpack';

const config: Configuration = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src', 'cli.js'),
  target: 'node',
  output: {
    filename: ProcessName.Cocoon,
    path: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  performance: {
    hints: false,
  },
  plugins: [new BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })],
};

export default config;
