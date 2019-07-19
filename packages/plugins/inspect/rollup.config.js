import { createComponentConfig } from '@cocoon/rollup';

const babel = require('rollup-plugin-babel');

export default createComponentConfig({
  production: true,
  plugins: [
    babel({
      runtimeHelpers: true,
      plugins: [['@babel/plugin-transform-runtime', { regenerator: true }]],
    }),
  ],
});
