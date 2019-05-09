import commonjs from 'rollup-plugin-commonjs';
import externalGlobals from 'rollup-plugin-external-globals';
import resolve from 'rollup-plugin-node-resolve';
import replace from 'rollup-plugin-replace';
import { terser } from 'rollup-plugin-terser';
import typescript from 'rollup-plugin-typescript';

const isDev = process.env.DEBUG !== undefined;

const productionPlugins = [
  terser(),
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
  }),
];

export default {
  input: './src/components/index.ts',
  plugins: [
    ...[
      typescript(),
      resolve({
        browser: true,
        only: ['echarts', 'd3-array'],
      }),
      commonjs({
        sourceMap: false,
      }),
      externalGlobals({
        react: 'React',
        'react-dom': 'ReactDOM',
        lodash: '_',
      }),
    ],
    ...(isDev ? [] : productionPlugins),
  ],
  output: {
    compact: !isDev,
    file: 'dist/components.js',
    format: 'esm',
  },
};
