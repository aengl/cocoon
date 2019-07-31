import fs from 'fs';
import path from 'path';
import { createAndInitialiseRegistry } from '../cocoon/src/registry';
import {
  CocoonNode,
  CocoonRegistry,
  CocoonView,
  InputPort,
  OutputPort,
  CocoonNodePorts,
} from '../types/dist';

const debug = require('debug')('docs:index');
const md = require('markdown-it')({
  linkify: true,
})
  .use(require('markdown-it-anchor'))
  .use(require('markdown-it-table-of-contents'));

const format = (
  obj: CocoonRegistry['nodes'] | CocoonRegistry['views'] | CocoonNodePorts,
  info: CocoonRegistry['nodeImports'] | CocoonRegistry['viewImports'],
  formatter: (key: string, value: any, info?: any) => string
) =>
  Object.entries(obj)
    .sort((a, b) => (a < b ? -1 : 1))
    .filter(
      ([key]) => !info[key] || info[key].module.indexOf('plugin-tibi') === -1
    )
    .map(([key, value]) => formatter(key, value, info[key]))
    .join('');

const pluginLink = (modulePath: string) => {
  const match = modulePath.match(/(?<plugin>@cocoon\/.*)\/dist/);
  return match && match.groups
    ? `[${match.groups.plugin}](https://www.npmjs.com/package/${match.groups.plugin})`
    : '?';
};

/**
 * Generates documentation for a Cocoon node.
 */
const formatNode = (name: string, node: CocoonNode, info: any) => `
## ${name}

${node.description || 'No description.'}

Plugin: ${info ? pluginLink(info.module) : 'built-in'}

### Input ports
${node.in ? format(node.in, {}, formatPort) : 'None'}
### Output ports
${node.out ? format(node.out, {}, formatPort) : 'None'}`;

/**
 * Generates documentation for a Cocoon port.
 */
const formatPort = (name: string, node: InputPort | OutputPort) => `
- \`${name}\` ${node.description || 'No description.'}
`;

/**
 * Generates documentation for a Cocoon view.
 */
const formatView = (name: string, node: CocoonView, info: any) => `
## ${name}

${node.description || 'No description.'}`;

/**
 * Generates documentation for all Cocoon nodes and views.
 */
const generateDocs = (registry: CocoonRegistry) => `
[[toc]]

# Nodes

${format(registry.nodes, registry.nodeImports, formatNode)}
# Views

${format(registry.views, registry.viewImports, formatView)}
`;

/**
 * Generates an HTML file from markdown.
 */
const markdownToHTML = (markdown: string, styles: string) => `
<html>
  <head>
    <style>${styles}</style>
  </head>
  <body>${md.render(markdown)}</body>
</html>
`;

(async () => {
  debug(`creating registryx`);
  const registry = await createAndInitialiseRegistry(path.resolve('.'));
  debug(`generating documentation`);
  const docs = generateDocs(registry);
  await fs.promises.writeFile(
    'index.html',
    markdownToHTML(
      docs,
      await fs.promises.readFile('styles.css', { encoding: 'utf8' })
    )
  );
})();
