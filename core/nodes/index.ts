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

export interface NodeContext<ConfigType = {}> {
  config: ConfigType;
  debug: import('debug').IDebugger;
  definitions: import('../definitions').CocoonDefinitions;
  definitionsPath: string;
  node: import('../graph').CocoonNode;
  readFromPort: <T = any>(port: string, defaultValue?: T) => T;
  writeToPort: <T = any>(port: string, value: T) => void;
  progress: (summary?: string, percent?: number) => void;
}

export interface NodeViewContext<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  nodeId: string;
  nodeType: string;
  debug: import('debug').IDebugger;
  viewData: ViewDataType;
  isPreview: boolean;
  setViewState: (state: ViewStateType) => void;
  query: (query: ViewQueryType) => ViewQueryResponseType;
  registerQueryListener: (args: Callback<NodeViewQueryResponseArgs>) => void;
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

  process?(context: NodeContext<ConfigType>): Promise<string | void>;

  serialiseViewData?(
    context: NodeContext<ConfigType>,
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
    context: NodeContext<ConfigType>,
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
  node.cache = _.merge(node.cache, {
    ports: { [port]: value },
  });
}
