import { createComponentConfig } from '@cocoon/rollup';

export default createComponentConfig({
  production: !process.env.DEBUG,
  resolveConfig: {
    only: ['echarts', 'd3-array'],
  },
});
