import commonjs from 'rollup-plugin-commonjs';
import externalGlobals from 'rollup-plugin-external-globals';
import resolve from 'rollup-plugin-node-resolve';
import replace from 'rollup-plugin-replace';
import { terser } from 'rollup-plugin-terser';
import typescript from 'rollup-plugin-typescript';

export default {
  input: './src/components/index.ts',
  plugins: [
    terser(),
    typescript(),
    resolve({
      browser: true,
      only: ['echarts', 'simple-statistics'],
    }),
    commonjs({
      sourceMap: false,
      namedExports: {
        'node_modules/react/index.js': ['useRef', 'useEffect'],
        'node_modules/simple-statistics/dist/simple-statistics.min.js': [
          'interquartileRange',
        ],
      },
    }),
    replace({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    externalGlobals({
      react: 'React',
      lodash: '_',
    }),
  ],
  output: {
    compact: true,
    file: 'dist/components.js',
    format: 'esm',
  },
};
