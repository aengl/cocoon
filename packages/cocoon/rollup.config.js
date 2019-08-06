const { terser } = require('rollup-plugin-terser');
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
    plugins: [typescript(compilerOptions), terser()],
    external: id => /@cocoon|tslib/.test(id),
  },
  {
    input: 'src/cli.ts',
    output: {
      banner: '#!/usr/bin/env node',
      file: 'src/cli.js',
      format: 'cjs',
    },
    plugins: [typescript(compilerOptions), terser()],
    external: () => true,
  },
];
