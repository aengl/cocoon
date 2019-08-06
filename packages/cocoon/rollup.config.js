const { terser } = require('rollup-plugin-terser');
const replace = require('rollup-plugin-replace');
const typescript = require('rollup-plugin-typescript');

const compilerOptions = {
  incremental: false,
  sourceMap: false,
};

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'src/index.js',
      format: 'cjs',
    },
    plugins: [
      typescript(compilerOptions),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      terser(),
    ],
    external: id => /@cocoon|tslib/.test(id),
  },
  {
    input: 'src/cli.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'src/cli.js',
      format: 'cjs',
    },
    plugins: [
      typescript(compilerOptions),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      terser(),
    ],
    external: () => true,
  },
];
