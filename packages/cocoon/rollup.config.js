const { terser } = require('rollup-plugin-terser');
const json = require('rollup-plugin-json');
const replace = require('rollup-plugin-replace');

export default [
  {
    input: 'src/index.js',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
    },
    plugins: [
      terser(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
        preventAssignment: true,
      }),
    ],
    external: id => /@cocoon|tslib|util/.test(id),
    onwarn: (warning, warn) =>
      warning.code === 'UNRESOLVED_IMPORT' ? null : warn(warning),
  },
  {
    input: 'src/cli.js',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cli.js',
      format: 'cjs',
    },
    plugins: [
      json(),
      terser(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
        preventAssignment: true,
      }),
    ],
    external: id => !/create|.json/.test(id),
  },
];
