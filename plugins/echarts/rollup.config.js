import commonjs from 'rollup-plugin-commonjs';
import typescript from 'rollup-plugin-typescript';

export default {
  input: './src/components/index.ts',
  plugins: [
    typescript(),
    commonjs({
      include: 'node_modules/css-element-queries/**',
    }),
  ],
  output: {
    file: 'dist/components.js',
    format: 'esm',
  },
};
