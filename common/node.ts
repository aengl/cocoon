import { NodeDefinition } from './definitions';

export enum NodeStatus {
  'unprocessed',
  'processing',
  'cached',
  'error',
}

export interface NodeCache {
  ports: { [outPort: string]: any };
}

export interface CocoonNode<ViewDataType = any, ViewStateType = any>
  extends NodeDefinition {
  cache?: NodeCache;
  definition: NodeDefinition;
  edgesIn: CocoonEdge[];
  edgesOut: CocoonEdge[];
  error?: Error;
  group: string;
  hot?: boolean;
  status: NodeStatus;
  summary?: string;
  type: string;
  viewData?: ViewDataType;
  viewState?: ViewStateType;
}

export interface CocoonEdge {
  from: CocoonNode;
  fromPort: string;
  to: CocoonNode;
  toPort: string;
}
