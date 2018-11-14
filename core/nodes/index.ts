import _ from 'lodash';
import path from 'path';
import { CocoonDefinitions, NodeObjectPorts } from '../../common/definitions';
import { CocoonNode } from '../../common/graph';
import { Callback, NodeViewQueryResponseArgs } from '../../common/ipc';
import { checkFile, parseJsonFile, writeJsonFile } from '../fs';

const nodes = _.merge(
  {},
  require('./data/Convert'),
  require('./data/Domain'),
  require('./data/ExtractKeyValue'),
  require('./data/Match'),
  require('./data/MatchAndMerge'),
  require('./data/Merge'),
  require('./data/ObjectToArray'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/WriteJSON'),
  require('./visualise/ECharts'),
  require('./visualise/Scatterplot'),
  require('./visualise/Table')
);

export interface NodeContext<ViewDataType = any, ViewStateType = any> {
  cloneFromPort: <T = any>(port: string, defaultValue?: T) => T;
  debug: (...args: any[]) => void;
  definitions: CocoonDefinitions;
  definitionsPath: string;
  node: CocoonNode<ViewDataType, ViewStateType>;
  progress: (summary?: string, percent?: number) => void;
  readFromPort: <T = any>(port: string, defaultValue?: T) => T;
  readPersistedCache: <T = any>(port: string) => Promise<T>;
  writePersistedCache: <T = any>(port: string, value: T) => Promise<void>;
  writeToPort: <T = any>(port: string, value: T) => void;
}

export interface NodeViewContext<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  debug: (...args: any[]) => void;
  height?: number;
  isPreview: boolean;
  node: CocoonNode<ViewDataType, ViewStateType>;
  query: (
    query: ViewQueryType,
    callback: Callback<NodeViewQueryResponseArgs>
  ) => ViewQueryResponseType;
  setViewState: (state: ViewStateType) => void;
  viewData: ViewDataType;
  width?: number;
}

export interface ICocoonNode<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> extends NodeObjectPorts {
  process?(
    context: NodeContext<ViewDataType, ViewStateType>
  ): Promise<object | string | void>;

  serialiseViewData?(
    context: NodeContext<ViewDataType, ViewStateType>,
    state?: ViewStateType
  ): ViewDataType;

  renderView?(
    context: NodeViewContext<
      ViewDataType,
      ViewStateType,
      ViewQueryType,
      ViewQueryResponseType
    >
  ): JSX.Element | null;

  respondToQuery?(
    context: NodeContext<ViewDataType, ViewStateType>,
    query: ViewQueryType
  ): ViewQueryResponseType;
}

export function getNode(type: string): ICocoonNode {
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
        node: nodes[type] as ICocoonNode,
        type,
      })),
    'type'
  );
}

export function listPorts(node: ICocoonNode, incoming: boolean) {
  return Object.keys(incoming ? node.in : node.out || {});
}

export function getInputPort(node: CocoonNode, port: string) {
  const nodeObj = getNode(node.type);
  if (nodeObj.in === undefined || nodeObj.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return nodeObj.in[port];
}

export function readInMemoryCache(node: CocoonNode, port: string) {
  if (
    !_.isNil(node.state.cache) &&
    node.state.cache.ports[port] !== undefined
  ) {
    return node.state.cache.ports[port];
  }
  return null;
}

export function readFromPort<T = any>(
  node: CocoonNode,
  port: string,
  defaultValue?: T
): T {
  // Check port definition
  const portDefinition = getInputPort(node, port);

  // Find edge that is connected to this node and port
  const incomingEdge = node.edgesIn.find(
    edge => edge.to.id === node.id && edge.toPort === port
  );

  if (incomingEdge !== undefined) {
    // Get cached data from the connected port
    const cache = readInMemoryCache(incomingEdge.from, incomingEdge.fromPort);
    if (cache) {
      return cache;
    }
  } else {
    // Read static data from the port definition
    const inDefinitions = node.in;
    if (inDefinitions !== undefined && inDefinitions[port] !== undefined) {
      return inDefinitions[port] as T;
    }
  }

  // Throw error if no default is specified and the port is required
  const portDefaultValue =
    defaultValue === undefined ? portDefinition.defaultValue : defaultValue;
  if (portDefinition.required && portDefaultValue === undefined) {
    throw new Error(`port "${port}" is empty`);
  }

  return portDefaultValue;
}

export function cloneFromPort<T = any>(
  node: CocoonNode,
  port: string,
  defaultValue?: T
): T {
  return _.cloneDeep(readFromPort(node, port, defaultValue));
}

export function writeToPort<T = any>(node: CocoonNode, port: string, value: T) {
  if (_.isNil(node.state.cache)) {
    node.state.cache = {
      ports: {},
    };
  }
  if (_.isNil(node.state.portInfo)) {
    node.state.portInfo = {};
  }
  node.state.cache.ports[port] = _.cloneDeep(value);
  node.state.portInfo[port] = {
    itemCount: _.get(value, 'length'),
  };
}

export async function readPersistedCache(node: CocoonNode, port: string) {
  const resolvedCachePath = checkFile(
    cachePath(node, port),
    global.definitionsPath
  );
  if (resolvedCachePath) {
    return parseJsonFile(resolvedCachePath);
  }
  return null;
}

export async function writePersistedCache(
  node: CocoonNode,
  port: string,
  value: any
) {
  return writeJsonFile(cachePath(node, port), value, global.definitionsPath);
}

export function listDimensions(
  data: object[],
  predicate?: (value: any, dimensionName: string) => boolean
) {
  const dimensionSet = data.reduce((dimensions: Set<string>, item: object) => {
    Object.keys(item).forEach(key => {
      if (
        !dimensions.has(key) &&
        (predicate === undefined || predicate(item[key], key))
      ) {
        dimensions.add(key);
      }
    });
    return dimensions;
  }, new Set());
  return [...dimensionSet.values()];
}

const cachePath = (node: CocoonNode, port: string) =>
  `_${path.basename(global.definitionsPath)}_${port}@${node.id}.json`;
