import { createComponentConfig } from '@cocoon/rollup';
import ecLangPlugin from 'echarts/build/rollup-plugin-ec-lang';

export default createComponentConfig({
  plugins: [ecLangPlugin({ lang: 'en' })],
  production: !process.env.DEBUG,
  resolveConfig: {
    only: ['echarts', 'd3-array'],
  },
});
