import _ from 'lodash';
import path from 'path';
import {
  getPortData,
  GraphNode,
  NodeCache,
  setPortData,
} from '../../common/graph';
import { NodeObject } from '../../common/node';
import { checkFile, parseJsonFile, removeFile, writeJsonFile } from '../fs';

const nodes = _.merge(
  {},
  require('./data/Convert'),
  require('./data/Domain'),
  require('./data/ExtractKeyValue'),
  require('./data/Match'),
  require('./data/MatchAndMerge'),
  require('./data/MatchAttributes'),
  require('./data/Merge'),
  require('./data/ObjectToArray'),
  require('./filter/FilterCustom'),
  require('./filter/FilterMatches'),
  require('./filter/FilterRanges'),
  require('./filter/FilterRows'),
  require('./io/EnqueueInCatirpel'),
  require('./io/JekyllCreateCollection'),
  require('./io/JekyllPublish'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/WriteJSON'),
  require('./service/UnshortenURLs'),
  require('./service/YoutubePlaylist')
);

export function getNodeObjectFromType(type: string): NodeObject {
  const node = nodes[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}

export function getNodeObjectFromNode(node: GraphNode): NodeObject {
  return getNodeObjectFromType(node.definition.type);
}

export function createNodeRegistry() {
  return _.sortBy(
    Object.keys(nodes)
      .filter(key => nodes[key].in || nodes[key].out)
      .map(type => ({
        node: nodes[type] as NodeObject,
        type,
      })),
    'type'
  ).reduce((all, x) => _.assign(all, { [x.type]: x.node }), {});
}

export function getInputPort(node: GraphNode, port: string) {
  const nodeObj = getNodeObjectFromNode(node);
  if (nodeObj.in === undefined || nodeObj.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return nodeObj.in[port];
}

export function readFromPort<T = any>(
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
  const portDefinition = getInputPort(node, port);

  // Throw error if no default is specified and the port is required
  const portDefaultValue =
    defaultValue === undefined ? portDefinition.defaultValue : defaultValue;
  if (portDefinition.required && portDefaultValue === undefined) {
    throw new Error(`port "${port}" is empty`);
  }

  return portDefaultValue;
}

export function cloneFromPort<T = any>(
  node: GraphNode,
  port: string,
  defaultValue?: T
): T {
  return _.cloneDeep(readFromPort(node, port, defaultValue));
}

export function writeToPort<T = any>(node: GraphNode, port: string, value: T) {
  setPortData(node, port, value);
}

export function nodeHasPersistedCache(node: GraphNode) {
  return checkFile(cachePath(node), global.definitionsPath) !== undefined;
}

export async function restorePersistedCache(node: GraphNode) {
  const resolvedCachePath = checkFile(cachePath(node), global.definitionsPath);
  if (resolvedCachePath !== undefined) {
    node.state.cache = await parseJsonFile<NodeCache>(resolvedCachePath);
    return node.state.cache;
  }
  return;
}

export async function writePersistedCache(node: GraphNode) {
  return writeJsonFile(
    cachePath(node),
    node.state.cache,
    global.definitionsPath
  );
}

export async function clearPersistedCache(node: GraphNode) {
  const resolvedCachePath = checkFile(cachePath(node), global.definitionsPath);
  if (resolvedCachePath !== undefined) {
    removeFile(resolvedCachePath);
  }
}

const cachePath = (node: GraphNode) =>
  `_${path.basename(global.definitionsPath)}_${node.id}.json`;
