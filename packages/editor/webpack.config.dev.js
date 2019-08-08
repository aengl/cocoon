const path = require('path');
const config = require('./webpack.config');

config.mode = 'development';
config.output.path = path.resolve(__dirname, 'src', 'ui');
config.module.rules.push({
  enforce: 'pre',
  exclude: /node_modules/,
  test: /\.js$/,
  use: ['source-map-loader'],
});
config.devtool = 'inline-source-map';

module.exports = config;
