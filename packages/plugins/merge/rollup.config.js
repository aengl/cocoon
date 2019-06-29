import { createComponentConfig } from '@cocoon/rollup';

export default createComponentConfig({
  production: !process.env.DEBUG,
  commonjsConfig: {
    namedExports: {
      'node_modules/react-is/index.js': [
        'ForwardRef',
        'isElement',
        'isValidElementType',
      ],
    },
  },
});
