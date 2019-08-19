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

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Node
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createNodeConfig = (
  name,
  {
    external = id => /@cocoon|tslib/.test(id),
    input = `./nodes/${name}.ts`,
    output = `./dist/${name}.js`,
    plugins = [],
    production = !process.env.DEBUG,
  } = {}
) => ({
  input,
  output: {
    file: output,
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
        sourcemap: !production,
      },
    }),
    ...(production ? productionPlugins : devPlugins),
    ...plugins,
  ],
  external,
});

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * View
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createViewConfig = (
  name,
  {
    external = id => /@cocoon|tslib/.test(id),
    input = `./views/${name}.ts`,
    output = `./dist/${name}Module.js`,
    plugins = [],
    production = !process.env.DEBUG,
  } = {}
) => ({
  input,
  output: {
    file: output,
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
        sourcemap: !production,
      },
    }),
    ...plugins,
    ...(production ? productionPlugins : devPlugins),
  ],
  external,
});

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Component
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createComponentConfig = (
  name,
  {
    commonjsConfig = {},
    input = `./components/${name}.tsx`,
    output = `./dist/${name}Component.js`,
    plugins = [],
    resolveConfig = {},
    production = !process.env.DEBUG,
  } = {}
) => ({
  input,
  output: {
    file: output,
    format: 'esm',
    sourcemap: production ? false : 'inline',
  },
  plugins: [
    json(),
    resolve({
      browser: true,
      ...resolveConfig,
    }),
    typescript({
      check: !production,
      tsconfigDefaults: {
        jsx: 'react',
        target: 'esnext',
      },
      tsconfigOverride: {
        module: 'esnext',
        sourcemap: !production,
      },
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
    ...plugins,
    ...(production ? productionPlugins : devPlugins),
  ],
});

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Exports
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createComponentAndViewConfigs = (name, componentConfig, viewConfig) => [
  createComponentConfig(name, componentConfig),
  createViewConfig(name, viewConfig),
];

module.exports = {
  createNodeConfig,
  createViewConfig,
  createComponentConfig,
  createComponentAndViewConfigs,

  createNodeBundleConfig: config =>
    createNodeConfig(null, {
      input: './nodes/index.ts',
      output: './dist/nodes.js',
      ...config,
    }),

  createViewBundleConfig: config =>
    createViewConfig(null, {
      input: './views/index.ts',
      output: './dist/views.js',
      ...config,
    }),

  createComponentBundle: config =>
    createComponentConfig(null, {
      input: './components/index.ts',
      output: './dist/components.js',
      ...config,
    }),

  createComponentAndViewBundleConfigs: (
    componentConfig = {},
    viewConfig = {}
  ) =>
    createComponentAndViewConfigs(
      null,
      {
        input: './components/index.ts',
        output: './dist/components.js',
        ...componentConfig,
      },
      {
        input: './views/index.ts',
        output: './dist/views.js',
        ...viewConfig,
      }
    ),
};
