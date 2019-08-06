import { createViewBundle } from '@cocoon/rollup';
import ecLangPlugin from 'echarts/build/rollup-plugin-ec-lang';

export default createViewBundle({
  plugins: [ecLangPlugin({ lang: 'en' })],
  resolveConfig: {
    only: ['echarts', 'd3-array'],
  },
});
