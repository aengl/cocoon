import { createComponentAndViewConfigs } from '@cocoon/rollup';

export default [
  ...createComponentAndViewConfigs('Gallery'),
  ...createComponentAndViewConfigs('HTML'),
  ...createComponentAndViewConfigs('Image'),
];
