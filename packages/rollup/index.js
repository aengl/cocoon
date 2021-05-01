const { babel } = require('@rollup/plugin-babel');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const { terser } = require('rollup-plugin-terser');
const commonjs = require('@rollup/plugin-commonjs');
const externalGlobals = require('rollup-plugin-external-globals');
const json = require('@rollup/plugin-json');
const replace = require('@rollup/plugin-replace');
const css = require('rollup-plugin-import-css');

const productionPlugins = [
  terser(),
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
    preventAssignment: true,
  }),
];

const devPlugins = [
  replace({
    'process.env.NODE_ENV': JSON.stringify('development'),
    preventAssignment: true,
  }),
];

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Node
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createNodeConfig = (
  name,
  {
    babelConfig,
    commonjsConfig,
    input = `./nodes/${name}.ts`,
    output = `./dist/${name}.js`,
    plugins = [],
    production = !process.env.DEBUG,
    resolveConfig,
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
    commonjs(commonjsConfig),
    nodeResolve({
      extensions: ['.js', '.ts'],
      resolveOnly: [
        // Needs at least one entry, otherwise it will resolve everything
        '__nothing',
      ],
      ...resolveConfig,
    }),
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.ts'],
      presets: ['@babel/preset-typescript', '@babel/preset-react'],
      ...babelConfig,
    }),
    ...(production ? productionPlugins : devPlugins),
    ...plugins,
  ],
});

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * View
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createViewConfig = (
  name,
  {
    babelConfig,
    commonjsConfig,
    input = `./views/${name}.ts`,
    output = `./dist/${name}Module.js`,
    plugins = [],
    production = !process.env.DEBUG,
    resolveConfig,
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
    commonjs(commonjsConfig),
    nodeResolve({
      extensions: ['.js', '.ts'],
      resolveOnly: [
        // Needs at least one entry, otherwise it will resolve everything
        '__nothing',
      ],
      ...resolveConfig,
    }),
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.ts'],
      presets: ['@babel/preset-typescript', '@babel/preset-react'],
      ...babelConfig,
    }),
    ...(production ? productionPlugins : devPlugins),
    ...plugins,
  ],
});

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Component
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

const createComponentConfig = (
  name,
  {
    babelConfig,
    commonjsConfig = {},
    input = `./components/${name}.tsx`,
    output = `./dist/${name}Component.js`,
    plugins = [],
    production = !process.env.DEBUG,
    resolveConfig = {},
  } = {}
) => ({
  input,
  output: {
    file: output,
    format: 'esm',
    sourcemap: production ? false : 'inline',
  },
  plugins: [
    css(),
    json(),
    commonjs(commonjsConfig),
    nodeResolve({
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      browser: true,
      ...resolveConfig,
    }),
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      // Currently does not work, wait for this PR to be merged:
      // https://github.com/vercel/styled-jsx/pull/690
      // plugins: ['styled-jsx/babel'],
      presets: ['@babel/preset-typescript', '@babel/preset-react'],
      ...babelConfig,
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

  createComponentBundleConfig: config =>
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
