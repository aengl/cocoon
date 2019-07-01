// tslint:disable:object-literal-sort-keys
import { ProcessName } from '@cocoon/types';
import path from 'path';
import { BannerPlugin, Configuration } from 'webpack';

const config: Configuration = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src', 'cli.js'),
  target: 'node',
  output: {
    filename: `${ProcessName.Cocoon}.js`,
    path: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  performance: {
    hints: false,
  },
  plugins: [new BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })],
  stats: {
    warningsFilter: [
      // Optional dependencies of `ws`
      // https://github.com/websockets/ws#opt-in-for-performance-and-spec-compliance
      /Module not found: Error: Can't resolve 'bufferutil'/,
      /Module not found: Error: Can't resolve 'utf-8-validate'/,
    ],
  },
};

export default config;
