import path from 'path';
import config from './webpack.editor';

config.mode = 'development';
config.output!.path = path.resolve(__dirname, 'editor', 'ui');
config.module!.rules.push({
  enforce: 'pre',
  exclude: /node_modules/,
  test: /\.js$/,
  use: ['source-map-loader'],
});
config.devtool = 'inline-source-map';

export default config;
