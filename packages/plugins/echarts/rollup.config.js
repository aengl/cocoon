import { createComponentAndViewBundleConfigs } from '@cocoon/rollup';
import ecLangPlugin from 'echarts/build/rollup-plugin-ec-lang';

export default createComponentAndViewBundleConfigs(
  {
    plugins: [ecLangPlugin({ lang: 'en' })],
    resolveConfig: {
      only: ['echarts', 'd3-array'],
    },
  },
  {
    plugins: [ecLangPlugin({ lang: 'en' })],
  }
);
