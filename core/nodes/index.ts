import _ from 'lodash';

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
  require('./visualize/Scatterplot')
);

/**
 * The context object received and returned by every node.
 */
export interface NodeContext<T = {}> {
  config: T;
  debug: import('debug').IDebugger;
  definitions: import('../definitions').CocoonDefinitions;
  definitionsPath: string;
  node: import('../graph').CocoonNode;
  progress: (summary?: string, percent?: number) => void;
}

export interface ICocoonNode<T = {}, U = any> {
  in?: {
    [id: string]: InputPortDefinition;
  };

  out?: {
    [id: string]: OutputPortDefinition;
  };

  process?(context: NodeContext<T>): Promise<string | void>;

  serialiseViewData?(context: NodeContext<T>): U;

  renderData?(
    serialisedData: U,
    width: number,
    height: number
  ): JSX.Element | null;
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

export function readInputPort<T>(
  node: import('../graph').CocoonNode,
  port: string,
  defaultValue?: any
) {
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
      return inDefinitions[port];
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

export function writeOutput(
  node: import('../graph').CocoonNode,
  port: string,
  value: any
) {
  node.cache = _.merge(node.cache, {
    ports: { [port]: value },
  });
}
