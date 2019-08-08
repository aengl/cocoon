import { createComponentAndViewConfigs } from '@cocoon/rollup';
import babel from 'rollup-plugin-babel';

export default createComponentAndViewConfigs('Inspector', {
  plugins: [
    babel({
      runtimeHelpers: true,
      plugins: [['@babel/plugin-transform-runtime', { regenerator: true }]],
    }),
  ],
});
