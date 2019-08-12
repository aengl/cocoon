const { terser } = require('rollup-plugin-terser');
const replace = require('rollup-plugin-replace');

export default [
  {
    input: 'src/cocoon-editor.js',
    output: {
      banner: '#!/usr/bin/env node --inspect=9340',
      file: 'dist/cocoon-editor.js',
      format: 'cjs',
    },
    plugins: [
      terser(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
    ],
    external: id => /@cocoon|commander|tslib/.test(id),
    onwarn: (warning, warn) =>
      warning.code === 'UNRESOLVED_IMPORT' ? null : warn(warning),
  },
  {
    input: 'src/cocoon-editor-http.js',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cocoon-editor-http.js',
      format: 'cjs',
    },
    plugins: [
      terser(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
    ],
    external: () => true,
  },
];
