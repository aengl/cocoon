import _ from 'lodash';
import { Context } from '../context';

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
}

export function readInputPort(context: Context, port: string) {
  // Check if connected nodes have data on this port
  const incomingData = context.node.edgesIn
    .filter(
      edge =>
        // Edge is connected to this node and port?
        edge.to.definition.id === context.node.definition.id &&
        edge.toPort === port &&
        // Edge has data on this port?
        edge.from.cache &&
        edge.from.cache.ports[port]
    )
    .map(edge => (edge.from.cache as any).ports[port]);

  if (incomingData.length > 0) {
    return incomingData.length === 1 ? _.first(incomingData) : incomingData;
  }

  // Read static data from the port definition
  const inDefinitions = context.node.definition.in;
  if (inDefinitions === undefined) {
    throw new Error(`no data on port ${port}`);
  }
  return inDefinitions[port];
}

export function readInputPortOrDefault(
  context: Context,
  port: string,
  defaultValue?: any
) {
  const inDefinitions = context.node.definition.in;
  if (inDefinitions) {
    return inDefinitions[port];
  }
  return defaultValue;
}

export function writeOutput(context: Context, port: string, value: any) {
  context.node.cache = _.merge(context.node.cache, {
    ports: { [port]: value },
  });
}

export * from './io/ReadJSON';
export * from './visualize/Scatterplot';
