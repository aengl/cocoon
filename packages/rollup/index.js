const { terser } = require('rollup-plugin-terser');
const commonjs = require('rollup-plugin-commonjs');
const externalGlobals = require('rollup-plugin-external-globals');
const json = require('rollup-plugin-json');
const replace = require('rollup-plugin-replace');
const resolve = require('rollup-plugin-node-resolve');
const typescript = require('rollup-plugin-typescript2');

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
    production = !process.env.DEBUG,
    plugins = [],
    external = id => /@cocoon|tslib/.test(id),
  } = {}
) => ({
  input,
  output: {
    file: output,
    format: 'cjs',
    sourcemap: production ? false : 'inline',
  },
  plugins: [
    json(jsonConfig),
    typescript({
      check: !production,
      tsconfigDefaults: {
        target: 'esnext',
      },
      tsconfigOverride: {
        module: 'commonjs',
      },
    }),
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
      sourcemap: production ? false : 'inline',
    },
    plugins: [
      json(),
      resolve({
        browser: true,
        ...componentResolve,
      }),
      typescript({
        check: !production,
        tsconfigDefaults: {
          jsx: 'react',
          target: 'esnext',
        },
        tsconfigOverride: {
          module: 'esnext',
        },
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
      sourcemap: production ? false : 'inline',
    },
    plugins: [
      json(),
      typescript({
        check: !production,
        tsconfigDefaults: {
          target: 'esnext',
        },
        tsconfigOverride: {
          module: 'commonjs',
        },
      }),
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
