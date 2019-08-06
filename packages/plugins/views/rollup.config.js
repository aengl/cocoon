import { createViewConfig } from '@cocoon/rollup';

export default [
  ...createViewConfig('Gallery'),
  ...createViewConfig('HTML'),
  ...createViewConfig('Image'),
];
