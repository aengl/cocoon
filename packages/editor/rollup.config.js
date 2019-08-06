const { terser } = require('rollup-plugin-terser');
const replace = require('rollup-plugin-replace');
const typescript = require('rollup-plugin-typescript');

const compilerOptions = {
  incremental: false,
  sourceMap: false,
};

export default [
  {
    input: 'src/cocoon-editor.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cocoon-editor.js',
      format: 'cjs',
    },
    plugins: [
      typescript(compilerOptions),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      terser(),
    ],
    external: id => /@cocoon|commander|tslib/.test(id),
  },
  {
    input: 'src/cocoon-editor-http.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cocoon-editor-http.js',
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
