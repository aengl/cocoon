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
  cache?: NodeCache | null;
  definition: NodeDefinition;
  edgesIn: CocoonEdge[];
  edgesOut: CocoonEdge[];
  error?: Error | null;
  group: string;
  hot?: boolean | null;
  status: NodeStatus;
  summary?: string | null;
  type: string;
  viewData?: ViewDataType | null;
  viewState?: ViewStateType | null;
}

export interface CocoonEdge {
  from: CocoonNode;
  fromPort: string;
  to: CocoonNode;
  toPort: string;
}

export type Graph = CocoonNode[];
