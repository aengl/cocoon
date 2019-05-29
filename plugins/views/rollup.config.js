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
      }),
      commonjs({
        sourceMap: false,
        namedExports: {
          'node_modules/react-is/index.js': [
            'ForwardRef',
            'isElement',
            'isValidElementType',
          ],
        },
      }),
      externalGlobals({
        lodash: '_',
        react: 'React',
        'react-dom': 'ReactDOM',
        'styled-components': 'styled',
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
