import _ from 'lodash';
import path from 'path';
import { CocoonDefinitionsInfo } from '../../common/definitions';
import {
  getPortData,
  Graph,
  GraphNode,
  NodeCache,
  PortData,
  setPortData,
} from '../../common/graph';
import {
  CocoonNode,
  CocoonNodeContext,
  CocoonNodePorts,
  CocoonRegistry,
} from '../../common/node';
import { getView } from '../../common/views';
import { checkPath, parseJsonFile, removeFile, writeJsonFile } from '../fs';
import { getCocoonNodeFromGraphNode } from '../registry';

export const defaultNodes = _.merge(
  {},
  require('./data/CreateCollection'),
  require('./data/Deduplicate'),
  require('./data/Domain'),
  require('./data/Flatten'),
  require('./data/Match'),
  require('./data/MatchAndMerge'),
  require('./data/MatchAttributes'),
  require('./data/Merge'),
  require('./data/ObjectToArray'),
  require('./data/Template'),
  require('./filter/FilterCustom'),
  require('./filter/FilterRanges'),
  require('./filter/FilterRows'),
  require('./io/Annotate'),
  require('./io/ImageDownloader'),
  require('./io/PipeJSON'),
  require('./io/PublishCollections'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/Run'),
  require('./io/WriteJSON'),
  require('./services/UnshortenURLs'),
  require('./services/YoutubePlaylist')
);

export async function updateView(
  node: GraphNode,
  cocoonNode: CocoonNode,
  context: CocoonNodeContext
) {
  if (node.view === undefined) {
    return;
  }
  const viewObj = getView(node.view);
  node.viewPort = node.viewPort ||
    // Fall back to default port
    viewObj.defaultPort ||
    cocoonNode.defaultPort || {
      incoming: false,
      name: 'data',
    };
  const data = getPortData(node, node.viewPort, context.graph);
  if (data !== undefined) {
    context.debug(`serialising rendering data for "${node.view}"`);
    node.state.viewData =
      viewObj.serialiseViewData === undefined
        ? data
        : await viewObj.serialiseViewData(
            context,
            data,
            node.definition.viewState || {}
          );
    node.state.viewDataId = Date.now();
  } else {
    context.debug(
      `skipped view rendering for "${node.view}": no data on port "${
        node.viewPort.name
      }"`
    );
  }
}

export async function respondToViewQuery(
  node: GraphNode,
  context: CocoonNodeContext,
  query: any
) {
  if (node.view === undefined) {
    return {};
  }
  const viewObj = getView(node.view);
  if (viewObj.respondToQuery === undefined) {
    throw new Error(`view "${node.view}" doesn't define a query response`);
  }
  context.debug(`received view data query`);
  const viewPortData = getPortData(node, node.viewPort!, context.graph);
  const data = viewObj.respondToQuery(context, viewPortData, query);
  return { data };
}

export function getInputPort(
  registry: CocoonRegistry,
  node: GraphNode,
  port: string
) {
  const cocoonNode = getCocoonNodeFromGraphNode(registry, node);
  if (cocoonNode.in === undefined || cocoonNode.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return cocoonNode.in[port];
}

export function readFromPort<T = any>(
  registry: CocoonRegistry,
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
  const portDefinition = getInputPort(registry, node, port);

  // Throw error if no default is specified and the port is required
  const portDefaultValue =
    defaultValue === undefined ? portDefinition.defaultValue : defaultValue;
  if (portDefinition.required && portDefaultValue === undefined) {
    throw new Error(`port "${port}" is empty`);
  }

  return portDefaultValue;
}

export function copy(value: any) {
  return _.cloneDeep(value);
}

export function copyFromPort<T = any>(
  registry: CocoonRegistry,
  node: GraphNode,
  graph: Graph,
  port: string,
  defaultValue?: T
): T {
  return copy(readFromPort(registry, node, graph, port, defaultValue));
}

export function readFromPorts<T extends PortData>(
  registry: CocoonRegistry,
  node: GraphNode,
  graph: Graph,
  ports: CocoonNodePorts['in']
): T {
  return Object.keys(ports).reduce(
    (result, port) => {
      result[port] = ports[port].clone
        ? copyFromPort(registry, node, graph, port)
        : readFromPort(registry, node, graph, port);
      return result;
    },
    ({} as any) as T
  );
}

export function writeToPort<T = any>(node: GraphNode, port: string, value: T) {
  setPortData(node, port, value);
}

export function writeToPorts(node: GraphNode, data: { [port: string]: any }) {
  Object.keys(data).forEach(key => writeToPort(node, key, data[key]));
}

export function persistIsEnabled(registry: CocoonRegistry, node: GraphNode) {
  const cocoonNode = getCocoonNodeFromGraphNode(registry, node);
  return (
    node.definition.persist === true ||
    (node.definition.persist === undefined && cocoonNode.persist === true)
  );
}

export function nodeHasPersistedCache(
  node: GraphNode,
  definitions: CocoonDefinitionsInfo
) {
  return (
    checkPath(cachePath(node, definitions), { root: definitions.root }) !==
    undefined
  );
}

export async function restorePersistedCache(
  node: GraphNode,
  definitions: CocoonDefinitionsInfo
) {
  const resolvedCachePath = checkPath(cachePath(node, definitions), {
    root: definitions.root,
  });
  if (resolvedCachePath !== undefined) {
    node.state.cache = await parseJsonFile<NodeCache>(resolvedCachePath);
    return node.state.cache;
  }
  return;
}

export async function writePersistedCache(
  node: GraphNode,
  definitions: CocoonDefinitionsInfo
) {
  return writeJsonFile(cachePath(node, definitions), node.state.cache, {
    root: definitions.root,
  });
}

export async function clearPersistedCache(
  node: GraphNode,
  definitions: CocoonDefinitionsInfo
) {
  const resolvedCachePath = checkPath(cachePath(node, definitions), {
    root: definitions.root,
  });
  if (resolvedCachePath !== undefined) {
    removeFile(resolvedCachePath);
  }
}

const cachePath = (node: GraphNode, definitions: CocoonDefinitionsInfo) =>
  `_${path.basename(definitions.path)}_${node.id}.json`;
