import _ from 'lodash';
import { CocoonDefinitionsInfo } from './definitions';
import { Graph, GraphNode, PortData, PortInfo } from './graph';

export interface CocoonNodeContext<
  PortDataType = PortData,
  ViewDataType = any,
  ViewStateType = any
> {
  debug: (...args: any[]) => void;
  definitions: CocoonDefinitionsInfo;
  fs: typeof import('../core/fs');
  graph: Graph;
  graphNode: GraphNode<PortDataType, ViewDataType, ViewStateType>;
  invalidate: () => void;
  ports: {
    copy: <T = any>(value: T) => T;
    read: () => PortDataType;
    write: (data: PortData) => void;
  };
  process: typeof import('../core/process');
  progress: (summary?: string, percent?: number) => void;
  uri: typeof import('../core/uri');
}

export interface InputPort {
  /**
   * This port clones the data when read, instead of passing the existing data
   * via reference.
   */
  clone?: boolean;

  /**
   * Falls back to a default value if no data was received.
   */
  defaultValue?: any;

  description?: string;

  /**
   * Hide in editor unless a value is assigned or the port is connected.
   */
  hide?: boolean;

  /**
   * The port will throw an error if no data was received.
   */
  required?: boolean;
}

export interface OutputPort {
  description?: string;
}

export interface CocoonNodePorts {
  in: {
    [id: string]: InputPort;
  };

  out?: {
    [id: string]: OutputPort;
  };
}

export interface CocoonNode<
  PortDataType = PortData,
  ViewDataType = any,
  ViewStateType = any
> extends CocoonNodePorts {
  category?: string;
  defaultPort?: PortInfo;
  description?: string;
  persist?: boolean;
  supportedViewStates?: string[];

  process(
    context: CocoonNodeContext<PortDataType, ViewDataType, ViewStateType>
  ): Promise<string | void>;

  receive?(
    context: CocoonNodeContext<PortDataType, ViewDataType, ViewStateType>,
    data: any
  ): void;
}

export function lookupPort(
  node: GraphNode,
  port: PortInfo
): InputPort | OutputPort | undefined {
  if (node.cocoonNode) {
    if (port.incoming) {
      return node.cocoonNode.in[port.name];
    } else if (node.cocoonNode.out) {
      return node.cocoonNode.out[port.name];
    }
  }
  return;
}

export function listPortNames(cocoonNode: CocoonNode, incoming: boolean) {
  if (_.isNil(cocoonNode)) {
    // Gracefully handle unknown nodes
    return [];
  }
  return Object.keys(incoming ? cocoonNode.in : cocoonNode.out || {});
}

export function listPorts(
  cocoonNode: CocoonNode,
  incoming: boolean
): PortInfo[] {
  return listPortNames(cocoonNode, incoming).map(name => ({
    incoming,
    name,
  }));
}

export function objectIsNode(obj: any): obj is CocoonNode {
  return obj.in && obj.process;
}
