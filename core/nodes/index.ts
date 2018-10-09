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
  const inDefinitions = context.node.definition.in;
  if (inDefinitions === undefined) {
    throw new Error(`TODO`);
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
