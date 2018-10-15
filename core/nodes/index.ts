import _ from 'lodash';
import { Context } from '../context';
import { CocoonNode } from '../graph';

interface InputPortDefinition {
  required?: boolean;
  defaultValue?: any;
}

interface OutputPortDefinition {}

const nodes = _.merge(
  {},
  require('./data/ExtractKeyValue'),
  require('./io/ReadCouchDB'),
  require('./io/ReadJSON'),
  require('./io/WriteJSON'),
  require('./visualize/Scatterplot')
);

export interface ICocoonNode<T = {}, U = any> {
  in?: {
    [id: string]: InputPortDefinition;
  };

  out?: {
    [id: string]: OutputPortDefinition;
  };

  process?(config: T, context: Context): Promise<string | void>;

  serialiseRenderingData?(node: CocoonNode): U;

  renderData?(
    serialisedData: U,
    width: number,
    height: number
  ): JSX.Element | null | undefined;
}

export function getNode(type: string): ICocoonNode {
  const node = nodes[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}

export function getInputPort(node: CocoonNode, port) {
  const nodeObj = getNode(node.type);
  if (nodeObj.in === undefined || nodeObj.in[port] === undefined) {
    throw new Error(`node "${node.definition.id}" has no "${port}" input port`);
  }
  return nodeObj.in[port];
}

export function readInputPort<T>(
  node: CocoonNode,
  port: string,
  defaultValue?: any
) {
  // Check port definition
  const portDefinition = getInputPort(node, port);

  // Find edge that is connected to this node and port
  const incomingEdge = node.edgesIn.find(
    edge => edge.to.definition.id === node.definition.id && edge.toPort === port
  );

  if (incomingEdge !== undefined) {
    // Get cached data from the connected port
    if (incomingEdge.from.cache && incomingEdge.from.cache.ports[port]) {
      return incomingEdge.from.cache.ports[port];
    }
  } else {
    // Read static data from the port definition
    const inDefinitions = node.definition.in;
    if (inDefinitions !== undefined && inDefinitions[port] !== undefined) {
      return inDefinitions[port];
    }
  }

  // Throw error if no default is specified and the port is required
  const portDefaultValue =
    defaultValue === undefined ? portDefinition.defaultValue : defaultValue;
  if (portDefinition.required && portDefaultValue === undefined) {
    throw new Error(`port "${port} is empty"`);
  }

  return portDefaultValue;
}

export function writeOutput(node: CocoonNode, port: string, value: any) {
  node.cache = _.merge(node.cache, {
    ports: { [port]: value },
  });
}
