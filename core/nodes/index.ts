import _ from 'lodash';
import { Callback, NodeViewQueryResponseArgs } from '../../ipc';

interface InputPortDefinition {
  required?: boolean;
  defaultValue?: any;
}

interface OutputPortDefinition {}

const nodes = _.merge(
  {},
  require('./data/ExtractKeyValue'),
  require('./data/Match'),
  require('./data/MatchAndMerge'),
  require('./data/Merge'),
  require('./data/ObjectToArray'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJS'),
  require('./io/ReadJSON'),
  require('./io/WriteJSON'),
  require('./visualize/ECharts'),
  require('./visualize/Scatterplot'),
  require('./visualize/Table')
);

export interface NodeContext<
  ConfigType = {},
  ViewDataType = any,
  ViewStateType = any
> {
  config: ConfigType;
  debug: import('debug').IDebugger;
  definitions: import('../definitions').CocoonDefinitions;
  definitionsPath: string;
  node: import('../graph').CocoonNode<ViewDataType, ViewStateType>;
  progress: (summary?: string, percent?: number) => void;
  readFromPort: <T = any>(port: string, defaultValue?: T) => T;
  writeToPort: <T = any>(port: string, value: T) => void;
}

export interface NodeViewContext<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  debug: import('debug').IDebugger;
  height: number;
  isPreview: boolean;
  nodeId: string;
  nodeType: string;
  query: (query: ViewQueryType) => ViewQueryResponseType;
  registerQueryListener: (args: Callback<NodeViewQueryResponseArgs>) => void;
  setViewState: (state: ViewStateType) => void;
  viewData: ViewDataType;
  width: number;
}

export interface ICocoonNode<
  ConfigType = {},
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  in?: {
    [id: string]: InputPortDefinition;
  };

  out?: {
    [id: string]: OutputPortDefinition;
  };

  process?(
    context: NodeContext<ConfigType, ViewDataType, ViewStateType>
  ): Promise<string | void>;

  serialiseViewData?(
    context: NodeContext<ConfigType, ViewDataType, ViewStateType>,
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
    context: NodeContext<ConfigType, ViewDataType, ViewStateType>,
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

export function getInputPort(node: import('../graph').CocoonNode, port) {
  const nodeObj = getNode(node.type);
  if (nodeObj.in === undefined || nodeObj.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return nodeObj.in[port];
}

export function readFromPort<T = any>(
  node: import('../graph').CocoonNode,
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
    if (
      incomingEdge.from.cache &&
      incomingEdge.from.cache.ports[incomingEdge.fromPort]
    ) {
      return incomingEdge.from.cache.ports[incomingEdge.fromPort];
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

export function writeToPort<T = any>(
  node: import('../graph').CocoonNode,
  port: string,
  value: T
) {
  console.warn('writing to', port);
  console.warn(_.isArray(value) && value.length);
  if (!node.cache) {
    node.cache = {
      ports: {},
    };
  }
  node.cache.ports[port] = value;
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
