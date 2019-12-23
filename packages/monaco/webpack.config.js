const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, './index.js'),
  output: {
    filename: 'cocoon-monaco.js',
    path: path.resolve(__dirname, 'dist'),
    // Webpack doesn't support creating standard-conform ESM bundles using the
    // export keyword yet, so we have to work around by assigning the component
    // to the window object
    library: 'CocoonMonaco',
    libraryTarget: 'window',
  },
  resolve: {
    extensions: ['.js', '.json', '.ttf'],
  },
  externals: {
    // Make doubly sure we don't bundle React!
    react: 'React',
  },
  performance: {
    hints: false,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.ttf$/,
        use: ['file-loader'],
      },
    ],
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
    }),
  ],
};
