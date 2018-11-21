import _ from 'lodash';
import path from 'path';
import { getPortData, GraphNode, setPortData } from '../../common/graph';
import { NodeObject } from '../../common/node';
import { checkFile, parseJsonFile, writeJsonFile } from '../fs';

export * from '../../common/data';
export * from '../../common/node';
export * from '../../common/view';

const nodes = _.merge(
  {},
  require('./data/Convert'),
  require('./data/Domain'),
  require('./data/ExtractKeyValue'),
  require('./data/Match'),
  require('./data/MatchAndMerge'),
  require('./data/Merge'),
  require('./data/ObjectToArray'),
  require('./filter/FilterRanges'),
  require('./filter/FilterRows'),
  require('./io/CreateJekyllCollection'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/WriteJSON')
);

export function getNode(type: string): NodeObject {
  const node = nodes[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}

export function listNodes() {
  return _.sortBy(
    Object.keys(nodes)
      .filter(key => nodes[key].in || nodes[key].out)
      .map(type => ({
        node: nodes[type] as NodeObject,
        type,
      })),
    'type'
  );
}

export function listPorts(nodeObj: NodeObject, incoming: boolean) {
  return Object.keys(incoming ? nodeObj.in : nodeObj.out || {});
}

export function getInputPort(node: GraphNode, port: string) {
  const nodeObj = getNode(node.type);
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

export async function readPersistedCache<T = any>(
  node: GraphNode,
  port: string
): Promise<T | undefined> {
  const resolvedCachePath = checkFile(
    cachePath(node, port),
    global.definitionsPath
  );
  if (resolvedCachePath) {
    return parseJsonFile(resolvedCachePath);
  }
  return;
}

export async function writePersistedCache(
  node: GraphNode,
  port: string,
  value: any
) {
  return writeJsonFile(cachePath(node, port), value, global.definitionsPath);
}

const cachePath = (node: GraphNode, port: string) =>
  `_${path.basename(global.definitionsPath)}_${port}@${node.id}.json`;
