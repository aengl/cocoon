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
    const componentPath = fs.resolvePath(component, {
      root: context.definitions.root,
    });
    const html = renderComponentToStaticMarkup(componentPath, { data });
    context.ports.writeAll({ html });
  },
};

export async function renderComponentToStaticMarkup(
  componentPath: string,
  props: object
) {
  delete require.cache[componentPath];
  const templateModule = await import(componentPath);
  return ReactDOMServer.renderToStaticMarkup(templateModule.default(props));
}
