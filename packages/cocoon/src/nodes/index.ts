import {
  getPortData,
  graphNodeRequiresCocoonNode,
  setPortData,
} from '@cocoon/shared/graph';
import {
  CocoonFileInfo,
  CocoonNodeContext,
  CocoonNodePorts,
  CocoonRegistry,
  Graph,
  GraphNode,
  NodeCache,
  PortData,
} from '@cocoon/types';
import requireCocoonView from '@cocoon/util/requireCocoonView';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';

const cachePath = (node: GraphNode, definitions: CocoonFileInfo) =>
  `_${path.basename(definitions.path)}_${node.id}.json`;

export const defaultNodes = _.merge(
  {},
  require('./data/ArrayToObject'),
  require('./data/Deduplicate'),
  require('./data/Flatten'),
  require('./data/Map'),
  require('./data/MatchAttributes'),
  require('./data/ObjectToArray'),
  require('./data/Sort'),
  require('./data/Template'),
  require('./filter/Filter'),
  require('./filter/FilterMatches'),
  require('./filter/FilterRanges'),
  require('./filter/FilterRows'),
  require('./io/Annotate'),
  require('./io/Download'),
  require('./io/PipeJSON'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/ReadYAML'),
  require('./io/Run'),
  require('./io/WriteJSON'),
  require('./services/UnshortenURLs')
);

export async function updateView(
  node: GraphNode,
  registry: CocoonRegistry,
  context: CocoonNodeContext
) {
  if (!node.view) {
    return;
  }
  try {
    const view = requireCocoonView(registry, node.view);
    node.viewPort = node.viewPort ||
      // Fall back to default port
      view.defaultPort ||
      node.cocoonNode!.defaultPort || {
        incoming: false,
        name: 'data',
      };
    const data = getPortData(node, node.viewPort, context.graph);
    if (data !== undefined) {
      context.debug(`serialising rendering data for "${node.view}"`);
      node.state.viewData = await view.serialiseViewData(
        context,
        data,
        node.definition.viewState || {}
      );
      node.state.viewDataId = Date.now();
    } else {
      context.debug(
        `skipped view rendering for "${node.view}": no data on port "${
          node.viewPort!.name
        }"`
      );
    }
  } catch (error) {
    context.debug(error);
    node.state.summary = error.message;
  }
}

export async function respondToViewQuery(
  node: GraphNode,
  registry: CocoonRegistry,
  context: CocoonNodeContext,
  query: any
) {
  if (!node.view) {
    return {};
  }
  const view = requireCocoonView(registry, node.view);
  if (view.respondToQuery === undefined) {
    throw new Error(`view "${node.view}" doesn't define a query response`);
  }
  context.debug(`received view query`, query);
  const viewPortData = getPortData(node, node.viewPort!, context.graph);
  const data = view.respondToQuery(context, viewPortData, query);
  context.debug(`sending view query response`, data);
  return { data };
}

export function getInputPort(node: GraphNode, port: string) {
  const cocoonNode = graphNodeRequiresCocoonNode(node);
  if (cocoonNode.in === undefined || cocoonNode.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return cocoonNode.in[port];
}

export function readFromPort<T = any>(
  node: GraphNode,
  graph: Graph,
  port: string,
  defaultValue?: T
): T {
  // Read port data
  const data = getPortData(node, { name: port, incoming: true }, graph);
  if (data !== undefined) {
    return data;
  }

  // If no data is available, check port definition
  const portDefinition = getInputPort(node, port);

  // Throw error if no default is specified and the port is required
  const portDefaultValue =
    defaultValue === undefined ? portDefinition.defaultValue : defaultValue;
  if (portDefinition.required && portDefaultValue === undefined) {
    throw new Error(`port "${port}" is empty`);
  }

  return portDefaultValue;
}

export function copyFromPort<T = any>(
  node: GraphNode,
  graph: Graph,
  port: string,
  defaultValue?: T
): T {
  return _.cloneDeep(readFromPort(node, graph, port, defaultValue));
}

export function readFromPorts<T extends PortData>(
  node: GraphNode,
  graph: Graph,
  ports: CocoonNodePorts['in']
): T {
  return Object.keys(ports).reduce((result: PortData, port) => {
    result[port] = ports[port].clone
      ? copyFromPort(node, graph, port)
      : readFromPort(node, graph, port);
    return result;
  }, {}) as T;
}

export function writeToPort<T = any>(node: GraphNode, port: string, value: T) {
  setPortData(node, port, value);
}

export function writeToPorts(node: GraphNode, data: { [port: string]: any }) {
  Object.keys(data).forEach(key => writeToPort(node, key, data[key]));
}

export function persistIsEnabled(node: GraphNode) {
  const cocoonNode = graphNodeRequiresCocoonNode(node);
  return (
    node.definition.persist === true ||
    (node.definition.persist === undefined && cocoonNode.persist === true)
  );
}

export async function restorePersistedCache(
  node: GraphNode,
  definitions: CocoonFileInfo
) {
  const p = cachePath(node, definitions);
  try {
    node.state.cache = JSON.parse(
      await fs.promises.readFile(p, { encoding: 'utf8' })
    ) as NodeCache;
    return node.state.cache;
  } catch (error) {
    // There was no cache file -- fail silently
    return null;
  }
}

export async function writePersistedCache(
  node: GraphNode,
  definitions: CocoonFileInfo
) {
  return fs.promises.writeFile(
    cachePath(node, definitions),
    JSON.stringify(node.state.cache)
  );
}

export async function clearPersistedCache(
  node: GraphNode,
  definitions: CocoonFileInfo
) {
  try {
    fs.promises.unlink(cachePath(node, definitions));
  } catch (error) {
    // There was no cache file -- fail silently
  }
}
