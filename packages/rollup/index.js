const commonjs = require('rollup-plugin-commonjs');
const externalGlobals = require('rollup-plugin-external-globals');
const json = require('rollup-plugin-json');
const resolve = require('rollup-plugin-node-resolve');
const replace = require('rollup-plugin-replace');
const { terser } = require('rollup-plugin-terser');
const typescript = require('rollup-plugin-typescript');

const productionPlugins = [
  terser(),
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
  }),
];

module.exports = {
  createComponentConfig: ({
    commonjsConfig = {},
    input = './components/index.ts',
    jsonConfig = {},
    output = './dist/components.js',
    production = true,
    resolveConfig = {},
    plugins = [],
  } = {}) => ({
    input,
    plugins: [
      ...[
        json(jsonConfig),
        typescript(),
        resolve({
          browser: true,
          ...resolveConfig,
        }),
        commonjs({
          sourceMap: !production,
          ...commonjsConfig,
        }),
        externalGlobals({
          lodash: '_',
          react: 'React',
          'react-dom': 'ReactDOM',
          'styled-components': 'styled',
        }),
      ],
      ...(production ? productionPlugins : []),
      ...plugins,
    ],
    output: {
      compact: production,
      file: output,
      format: 'esm',
    },
  }),
};
