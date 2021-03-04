const { terser } = require('rollup-plugin-terser');
const replace = require('@rollup/plugin-replace');
const typescript = require('@rollup/plugin-typescript');

export default [
  {
    input: 'src/cocoon-editor.ts',
    output: {
      banner: '#!/usr/bin/env node --inspect=9340',
      file: 'dist/cocoon-editor.js',
      format: 'cjs',
    },
    plugins: [
      typescript(),
      terser(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
    ],
    external: id =>
      /@cocoon|child_process|commander|debug|open|path|tslib|ws/.test(id),
  },
  {
    input: 'src/cocoon-editor-http.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cocoon-editor-http.js',
      format: 'cjs',
    },
    plugins: [
      typescript(),
      terser(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
    ],
    external: id => /fs|http|mime-types|path|url|util/.test(id),
  },
];
