import ReactDOMServer from 'react-dom/server';
import { CocoonNode } from '../../../common/node';

export interface Ports {
  component: string;
  data: object[];
}

export const Template: CocoonNode<Ports> = {
  category: 'Data',
  description: `Renders static markup by using a React component as a template.`,

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
    const { component, data } = context.ports.read();
    const componentPath = fs.resolvePath(component, {
      root: context.definitions.root,
    });
    const html = renderComponentToStaticMarkup(componentPath, { data });
    context.ports.write({ html });
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
