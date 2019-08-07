const { terser } = require('rollup-plugin-terser');
const replace = require('rollup-plugin-replace');
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

const production = !process.env.DEBUG;

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: production ? false : 'inline',
    },
    plugins: [
      typescript({
        check: !production,
      }),
      ...(production ? productionPlugins : devPlugins),
    ],
    external: id => /@cocoon|tslib|util/.test(id),
  },
  {
    input: 'src/cli.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cli.js',
      format: 'cjs',
      sourcemap: production ? false : 'inline',
    },
    plugins: [
      typescript({
        check: !production,
      }),
      ...(production ? productionPlugins : devPlugins),
    ],
    external: () => true,
  },
];
