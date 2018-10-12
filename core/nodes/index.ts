import _ from 'lodash';
import { Context } from '../context';
import { CocoonNode } from '../graph';

interface InputPortDefinition {
  required?: boolean;
}

interface OutputPortDefinition {}

const nodes = _.merge(
  {},
  require('./io/ReadCouchDB'),
  require('./io/ReadJSON'),
  require('./visualize/Scatterplot')
);

export interface ICocoonNode<T = {}, U = any> {
  in?: {
    [id: string]: InputPortDefinition;
  };

  out?: {
    [id: string]: OutputPortDefinition;
  };

  process?(config: T, context: Context): Promise<void>;

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

export function readInputPort(
  node: CocoonNode,
  port: string,
  defaultValue?: any
) {
  // Check if connected nodes have data on this port
  const incomingData = node.edgesIn
    .filter(
      edge =>
        // Edge is connected to this node and port?
        edge.to.definition.id === node.definition.id &&
        edge.toPort === port &&
        // Edge has data on this port?
        edge.from.cache &&
        edge.from.cache.ports[port]
    )
    .map(edge => edge.from.cache!.ports[port]);

  if (incomingData.length > 0) {
    return incomingData.length === 1 ? _.first(incomingData) : incomingData;
  }

  // Read static data from the port definition
  const inDefinitions = node.definition.in;
  if (inDefinitions !== undefined && inDefinitions[port] !== undefined) {
    return inDefinitions[port];
  }

  // Throw error if no default is specified
  if (defaultValue === undefined) {
    throw new Error(`no data on port ${port}`);
  }

  return defaultValue;
}

export function writeOutput(node: CocoonNode, port: string, value: any) {
  node.cache = _.merge(node.cache, {
    ports: { [port]: value },
  });
}
