import { CocoonNode } from '@cocoon/types';
import ReactDOMServer from 'react-dom/server';

export interface Ports {
  component: string;
  data: object[];
}

export const Template: CocoonNode<Ports> = {
  category: 'Data',
  description: `Renders static markup by using a React component as a template.`,

  in: {
    component: {
      required: true,
      visible: false,
    },
    data: {
      required: true,
    },
  },

  out: {
    html: {},
  },

  async *process(context) {
    const { component, data } = context.ports.read();
    const html = renderComponentToStaticMarkup(component, { data });
    context.ports.write({ html });
  },
};

export async function renderComponentToStaticMarkup(
  componentPath: string,
  props: object
) {
  delete require.cache[componentPath];
  // Using `eval` to have webpack ignore the import
  const templateModule = await eval(`import(${componentPath})`);
  return ReactDOMServer.renderToStaticMarkup(templateModule.default(props));
}
