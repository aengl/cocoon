import _ from 'lodash';
import { CocoonDefinitions } from './definitions';
import { GraphNode, PortInfo } from './graph';

export interface NodeContext<ViewDataType = any, ViewStateType = any> {
  cloneFromPort: <T = any>(port: string, defaultValue?: T) => T;
  debug: (...args: any[]) => void;
  definitions: CocoonDefinitions;
  definitionsRoot: string;
  fs: typeof import('../core/fs');
  node: GraphNode<ViewDataType, ViewStateType>;
  progress: (summary?: string, percent?: number) => void;
  readFromPort: <T = any>(port: string, defaultValue?: T) => T;
  writeToPort: <T = any>(port: string, value: T) => void;
}

export interface InputPort {
  required?: boolean;
  defaultValue?: any;
}

export interface OutputPort {}

export interface NodePorts {
  in: {
    [id: string]: InputPort;
  };

  out?: {
    [id: string]: OutputPort;
  };
}

export interface NodeObject<ViewDataType = any, ViewStateType = any>
  extends NodePorts {
  category?: string;
  defaultPort?: PortInfo;
  persist?: boolean;
  supportedViewStates?: string[];

  process(
    context: NodeContext<ViewDataType, ViewStateType>
  ): Promise<string | void>;
}

export interface NodeRegistry {
  [nodeType: string]: NodeObject | undefined;
}

export function lookupNodeObject(node: GraphNode, nodeRegistry: NodeRegistry) {
  return nodeRegistry[node.definition.type];
}

export function listPorts(nodeObj: NodeObject, incoming: boolean) {
  if (_.isNil(nodeObj)) {
    // Gracefully handle unknown nodes
    return [];
  }
  return Object.keys(incoming ? nodeObj.in : nodeObj.out || {});
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
