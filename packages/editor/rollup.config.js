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
    input: 'src/cocoon-editor.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cocoon-editor.js',
      format: 'cjs',
      sourcemap: production ? false : 'inline',
    },
    plugins: [
      typescript({
        check: !production,
      }),
      ...(production ? productionPlugins : devPlugins),
    ],
    external: id => /@cocoon|commander|tslib/.test(id),
  },
  {
    input: 'src/cocoon-editor-http.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'dist/cocoon-editor-http.js',
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
