import { createViewConfig } from '@cocoon/rollup';
import babel from 'rollup-plugin-babel';

export default createViewConfig('Inspector', {
  componentPlugins: [
    babel({
      runtimeHelpers: true,
      plugins: [['@babel/plugin-transform-runtime', { regenerator: true }]],
    }),
  ],
});
