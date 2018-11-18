import { CocoonDefinitions } from './definitions';
import { GraphNode } from './graph';

export interface NodeContext<ViewDataType = any, ViewStateType = any> {
  cloneFromPort: <T = any>(port: string, defaultValue?: T) => T;
  debug: (...args: any[]) => void;
  definitions: CocoonDefinitions;
  definitionsPath: string;
  node: GraphNode<ViewDataType, ViewStateType>;
  progress: (summary?: string, percent?: number) => void;
  readFromPort: <T = any>(port: string, defaultValue?: T) => T;
  readPersistedCache: <T = any>(port: string) => Promise<T>;
  writePersistedCache: <T = any>(port: string, value: T) => Promise<void>;
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

export interface NodeObject extends NodePorts {
  process?(context: NodeContext): Promise<string | void>;
}