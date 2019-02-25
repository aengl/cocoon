import _ from 'lodash';
import path from 'path';
import { CocoonDefinitionsInfo } from '../../common/definitions';
import {
  getPortData,
  GraphNode,
  NodeCache,
  setPortData,
} from '../../common/graph';
import { NodePorts, NodeRegistry } from '../../common/node';
import { checkFile, parseJsonFile, removeFile, writeJsonFile } from '../fs';
import { getNodeObjectFromNode } from '../registry';

export const defaultNodes = _.merge(
  {},
  require('./data/Convert'),
  require('./data/Deduplicate'),
  require('./data/Domain'),
  require('./data/ExtractKeyValue'),
  require('./data/Match'),
  require('./data/MatchAndMerge'),
  require('./data/MatchAttributes'),
  require('./data/Merge'),
  require('./data/ObjectToArray'),
  require('./data/Score'),
  require('./filter/FilterCustom'),
  require('./filter/FilterMatches'),
  require('./filter/FilterRanges'),
  require('./filter/FilterRows'),
  require('./io/EnqueueInCatirpel'),
  require('./io/ImageDownloader'),
  require('./io/JekyllCreateCollection'),
  require('./io/JekyllPublish'),
  require('./io/PipeJSON'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/Run'),
  require('./io/WriteJSON'),
  require('./services/UnshortenURLs'),
  require('./services/YoutubePlaylist')
);

export function getInputPort(
  registry: NodeRegistry,
  node: GraphNode,
  port: string
) {
  const nodeObj = getNodeObjectFromNode(registry, node);
  if (nodeObj.in === undefined || nodeObj.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return nodeObj.in[port];
}

export function readFromPort<T = any>(
  registry: NodeRegistry,
  node: GraphNode,
  port: string,
  defaultValue?: T
): T {
  // Read port data
  const data = getPortData(node, { name: port, incoming: true });
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

export function copyFromPort<T = any>(
  registry: NodeRegistry,
  node: GraphNode,
  port: string,
  defaultValue?: T
): T {
  return _.cloneDeep(readFromPort(registry, node, port, defaultValue));
}

export function readInputPorts(
  registry: NodeRegistry,
  node: GraphNode,
  ports: NodePorts['in']
): { [port: string]: any } {
  return Object.keys(ports).reduce((result, port) => {
    result[port] = ports[port].clone
      ? copyFromPort(registry, node, port)
      : readFromPort(registry, node, port);
    return result;
  }, {});
}

export function writeToPort<T = any>(node: GraphNode, port: string, value: T) {
  setPortData(node, port, value);
}

export function writeOutputPorts(
  node: GraphNode,
  data: { [port: string]: any }
) {
  Object.keys(data).forEach(key => writeToPort(node, key, data[key]));
}

export function persistIsEnabled(registry: NodeRegistry, node: GraphNode) {
  const nodeObj = getNodeObjectFromNode(registry, node);
  return (
    node.definition.persist === true ||
    (node.definition.persist === undefined && nodeObj.persist === true)
  );
}

export function nodeHasPersistedCache(
  node: GraphNode,
  definitions: CocoonDefinitionsInfo
) {
  return (
    checkFile(cachePath(node, definitions), { root: definitions.root }) !==
    undefined
  );
}

export async function restorePersistedCache(
  node: GraphNode,
  definitions: CocoonDefinitionsInfo
) {
  const resolvedCachePath = checkFile(cachePath(node, definitions), {
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
  const resolvedCachePath = checkFile(cachePath(node, definitions), {
    root: definitions.root,
  });
  if (resolvedCachePath !== undefined) {
    removeFile(resolvedCachePath);
  }
}

const cachePath = (node: GraphNode, definitions: CocoonDefinitionsInfo) =>
  `_${path.basename(definitions.path)}_${node.id}.json`;
