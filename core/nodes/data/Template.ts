import ReactDOMServer from 'react-dom/server';
import { NodeObject } from '../../../common/node';

export const Template: NodeObject = {
  category: 'Data',

  in: {
    component: {
      hide: true,
      required: true,
    },
    data: {
      required: true,
    },
  },

  out: {
    html: {},
  },

  async process(context) {
    const { fs } = context;
    const component = context.ports.read<string>('component');
    const data = context.ports.read<object[]>('data');
    const modulePath = fs.resolvePath(component, {
      root: context.definitions.root,
    });
    delete require.cache[modulePath];
    const templateModule = await import(modulePath);
    const html = ReactDOMServer.renderToStaticMarkup(
      templateModule.default({ data })
    );
    context.ports.writeAll({ html });
  },
};
