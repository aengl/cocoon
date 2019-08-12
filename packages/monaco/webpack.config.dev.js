const config = require('./webpack.config');

config.mode = 'development';
config.devtool = 'inline-source-map';
config.output.path = __dirname;
config.module.rules.push({
  enforce: 'pre',
  exclude: /node_modules/,
  test: /\.js$/,
  use: ['source-map-loader'],
});

module.exports = config;
