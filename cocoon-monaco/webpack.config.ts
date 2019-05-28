// tslint:disable:object-literal-sort-keys
// tslint:disable:no-implicit-dependencies

import _ from 'lodash';
import { Configuration } from 'webpack';

const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

export const isDev = Boolean(process.env.DEBUG);

const config: Configuration = {
  mode: isDev ? 'development' : 'production',
  entry: './Editor.js',
  output: {
    filename: 'cocoon-monaco.js',
    path: __dirname,
    // Webpack doesn't support creating standard-conform ESM bundles using the
    // export keyword yet, so we have to work around by assigning the component
    // to the window object
    library: 'CocoonMonaco',
    libraryTarget: 'window',
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  performance: {
    hints: false,
  },
  plugins: [
    new MonacoWebpackPlugin({
      languages: ['yaml'],
      features: [
        '!accessibilityHelp',
        '!bracketMatching',
        'caretOperations',
        'clipboard',
        '!codeAction',
        '!codelens',
        '!colorDetector',
        'comment',
        '!contextmenu',
        'coreCommands',
        'cursorUndo',
        'dnd',
        'find',
        'folding',
        '!fontZoom',
        'format',
        '!goToDefinitionCommands',
        '!goToDefinitionMouse',
        '!gotoError',
        'gotoLine',
        'hover',
        'inPlaceReplace',
        'inspectTokens',
        '!iPadShowKeyboard',
        'linesOperations',
        '!links',
        'multicursor',
        '!parameterHints',
        '!quickCommand',
        '!quickOutline',
        '!referenceSearch',
        '!rename',
        '!smartSelect',
        '!snippets',
        '!suggest',
        '!toggleHighContrast',
        '!toggleTabFocusMode',
        '!transpose',
        'wordHighlighter',
        'wordOperations',
        'wordPartOperations',
      ],
    }) as any,
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
  });
  config.module!.rules.push({
    test: /\.js$/,
    use: ['source-map-loader'],
    enforce: 'pre',
    exclude: /node_modules/,
  });
}

export default config;
