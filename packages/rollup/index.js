const { terser } = require('rollup-plugin-terser');
const commonjs = require('rollup-plugin-commonjs');
const externalGlobals = require('rollup-plugin-external-globals');
const json = require('rollup-plugin-json');
const replace = require('rollup-plugin-replace');
const resolve = require('rollup-plugin-node-resolve');
const typescript = require('rollup-plugin-typescript');

const productionPlugins = [
  terser(),
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
  }),
];

const devPlugins = [
  replace({
    'process.env.NODE_ENV': JSON.stringify('development'),
  }),
];

const createNodeConfig = (
  name,
  {
    input = `./nodes/${name}.ts`,
    jsonConfig = {},
    output = `./dist/${name}.js`,
    production = true,
    plugins = [],
    external = id => /@cocoon|tslib/.test(id),
  } = {}
) => ({
  input,
  output: {
    compact: production,
    file: output,
    format: 'cjs',
  },
  plugins: [
    ...[json(jsonConfig), typescript()],
    ...(production ? productionPlugins : devPlugins),
    ...plugins,
  ],
  external,
});

const createViewConfig = (
  name,
  {
    componentCommonJS = {},
    componentInput = `./components/${name}.tsx`,
    componentOutput = `./dist/${name}Component.js`,
    componentPlugins = [],
    componentResolve = {},
    production = !process.env.DEBUG,
    viewExternal = id => /@cocoon|tslib/.test(id),
    viewInput = `./views/${name}.ts`,
    viewOutput = `./dist/${name}Module.js`,
    viewPlugins = [],
  } = {}
) => [
  {
    input: componentInput,
    output: {
      file: componentOutput,
      format: 'esm',
    },
    plugins: [
      json(),
      typescript(),
      resolve({
        browser: true,
        ...componentResolve,
      }),
      commonjs({
        sourceMap: !production,
        ...componentCommonJS,
      }),
      externalGlobals({
        lodash: '_',
        react: 'React',
        'react-dom': 'ReactDOM',
        'styled-components': 'styled',
      }),
      ...componentPlugins,
      ...(production ? productionPlugins : devPlugins),
    ],
  },
  {
    input: viewInput,
    output: {
      file: viewOutput,
      format: 'cjs',
    },
    plugins: [
      json(),
      typescript(),
      ...viewPlugins,
      ...(production ? productionPlugins : devPlugins),
    ],
    external: viewExternal,
  },
];

module.exports = {
  createNodeBundle: config =>
    createNodeConfig(null, {
      ...config,
      input: './nodes/index.ts',
      output: './dist/nodes.js',
    }),
  createNodeConfig,
  createViewBundle: config =>
    createViewConfig(null, {
      ...config,
      componentInput: './components/index.ts',
      componentOutput: './dist/components.js',
      viewInput: './views/index.ts',
      viewOutput: './dist/views.js',
    }),
  createViewConfig,
};
