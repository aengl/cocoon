import { createComponentConfig } from '@cocoon/rollup';

export default createComponentConfig({
  production: !process.env.DEBUG,
});
