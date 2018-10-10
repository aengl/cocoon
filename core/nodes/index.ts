import _ from 'lodash';
import { Context } from '../context';
import { CocoonNode } from '../graph';

export interface ICocoonNode<T> {
  in?: {
    [id: string]: {
      required?: boolean;
    };
  };

  out?: {
    [id: string]: {};
  };

  /**
   * TODO
   */
  process(config: T, context: Context): Promise<void>;

  renderData?(
    node: CocoonNode,
    width: number,
    height: number
  ): JSX.Element | null | undefined;
}

export function readInputPort(node: CocoonNode, port: string) {
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
  if (inDefinitions === undefined) {
    throw new Error(`no data on port ${port}`);
  }
  return inDefinitions[port];
}

export function readInputPortOrDefault(
  node: CocoonNode,
  port: string,
  defaultValue?: any
) {
  const inDefinitions = node.definition.in;
  if (inDefinitions) {
    return inDefinitions[port];
  }
  return defaultValue;
}

export function writeOutput(node: CocoonNode, port: string, value: any) {
  node.cache = _.merge(node.cache, {
    ports: { [port]: value },
  });
}

export * from './io/ReadJSON';
export * from './visualize/Scatterplot';
