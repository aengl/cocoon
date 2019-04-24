import _ from 'lodash';
import { CocoonDefinitionsInfo } from './definitions';
import { Graph, GraphNode, PortInfo, PortData } from './graph';

export interface NodeContext<
  PortDataType = PortData,
  ViewDataType = any,
  ViewStateType = any
> {
  debug: (...args: any[]) => void;
  definitions: CocoonDefinitionsInfo;
  fs: typeof import('../core/fs');
  graph: Graph;
  node: GraphNode<ViewDataType, ViewStateType>;
  process: typeof import('../core/process');
  ports: {
    copy: <T = any>(value: T) => T;
    read: () => PortDataType;
    write: (data: PortData) => void;
  };
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

export interface NodePorts {
  in: {
    [id: string]: InputPort;
  };

  out?: {
    [id: string]: OutputPort;
  };
}

export interface NodeObject<
  PortDataType = PortData,
  ViewDataType = any,
  ViewStateType = any
> extends NodePorts {
  category?: string;
  defaultPort?: PortInfo;
  description?: string;
  persist?: boolean;
  supportedViewStates?: string[];

  process(
    context: NodeContext<PortDataType, ViewDataType, ViewStateType>
  ): Promise<string | void>;
}

export interface NodeRegistry {
  [nodeType: string]: NodeObject | undefined;
}

export function lookupNodeObject(node: GraphNode, nodeRegistry: NodeRegistry) {
  return nodeRegistry[node.definition.type];
}

export function lookupPort(
  node: GraphNode,
  port: PortInfo,
  nodeRegistry: NodeRegistry
): InputPort | OutputPort | undefined {
  const nodeObj = lookupNodeObject(node, nodeRegistry);
  if (nodeObj) {
    if (port.incoming) {
      return nodeObj.in[port.name];
    } else if (nodeObj.out) {
      return nodeObj.out[port.name];
    }
  }
  return;
}

export function listPortNames(nodeObj: NodeObject, incoming: boolean) {
  if (_.isNil(nodeObj)) {
    // Gracefully handle unknown nodes
    return [];
  }
  return Object.keys(incoming ? nodeObj.in : nodeObj.out || {});
}

export function listPorts(nodeObj: NodeObject, incoming: boolean): PortInfo[] {
  return listPortNames(nodeObj, incoming).map(name => ({
    incoming,
    name,
  }));
}

export function listCategories(nodeRegistry: NodeRegistry) {
  return _.sortBy(
    _.uniq(
      Object.values(nodeRegistry).map(nodeObj =>
        nodeObj ? nodeObj.category : undefined
      )
    )
  );
}

export function objectIsNode(obj: any): obj is NodeObject {
  return obj.in && obj.process;
}
