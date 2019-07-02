/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface CocoonNodeContext<
  PortDataType = PortData,
  ViewDataType = any,
  ViewStateType = any
> {
  debug: DebugFunction;
  definitions: CocoonDefinitionsInfo;
  fs: any;
  graph: Graph;
  graphNode: GraphNode<PortDataType, ViewDataType, ViewStateType>;
  invalidate: () => void;
  ports: {
    read: () => PortDataType;
    write: (data: PortData) => void;
  };
  processTemporaryNode: (
    nodeType: string,
    portData: PortData
  ) => Promise<PortData>;
  progress: (summary?: string, percent?: number) => void;
  registry: CocoonRegistry;
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

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Graph
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export enum NodeStatus {
  'processing',
  'processed',
  'error',
}

export interface NodeCache {
  ports: { [outPort: string]: any };
}

export interface PortData {
  [port: string]: any;
}

export interface PortStatistics {
  [port: string]: {
    itemCount: number;
  };
}

export interface PortInfo {
  incoming: boolean;
  name: string;
}

export interface GraphNodeState<ViewDataType = any> {
  cache?: NodeCache;
  error?: Error;
  portStats?: PortStatistics;
  scheduled?: boolean;
  status?: NodeStatus;
  summary?: string;
  viewData?: ViewDataType;
  viewDataId?: number;
}

export interface GraphNode<
  PortDataType = PortData,
  ViewDataType = any,
  ViewStateType = any
> {
  cocoonNode?: CocoonNode<PortDataType, ViewDataType, ViewStateType>;
  definition: CocoonNodeDefinition<ViewStateType>;
  edgesIn: GraphEdge[];
  edgesOut: GraphEdge[];
  hot?: boolean;
  id: string; // alias for `definition.id`, for convenience
  state: GraphNodeState<ViewDataType>;
  syncId?: number;
  view?: string;
  viewPort?: PortInfo;
}

export interface GraphEdge {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface Graph {
  nodes: GraphNode[];
  map: Map<string, GraphNode>;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Definitions
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface CocoonNodeActions {
  [actionName: string]: string;
}

export interface CocoonNodeDefinition<ViewStateType = any> {
  '?'?: string;
  description?: string;
  editor?: {
    actions?: CocoonNodeActions;
    col?: number;
    row?: number;
  };
  in?: { [id: string]: any };
  persist?: boolean;
  type: string;
  view?: string;
  viewState?: ViewStateType;
}

export interface CocoonFile {
  description?: string;
  nodes: { [nodeId: string]: CocoonNodeDefinition };
}

export interface CocoonDefinitionsInfo {
  parsed?: CocoonFile;
  path: string;
  raw: string;
  root: string;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Views
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface CocoonViewContext<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  debug: (...args: any[]) => void;
  graphNode: GraphNode<ViewDataType, ViewStateType>;
  height?: number;
  isPreview: boolean;
  node: {
    id: string;
    supportedViewStates: string[] | undefined;
    supportsViewState: (viewStateKey: string) => boolean;
  };
  query: (
    query: ViewQueryType,
    callback: (args: { data?: any }) => any
  ) => ViewQueryResponseType;
  send: (data: any) => void;
  syncViewState: (state: ViewStateType) => void;
  viewData: ViewDataType;
  viewState: ViewStateType;
  viewPort: PortInfo;
  width?: number;
}

export interface CocoonViewProps<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  context: CocoonViewContext<
    ViewDataType,
    ViewStateType,
    ViewQueryType,
    ViewQueryResponseType
  >;
}

export interface CocoonView<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  component?: string;

  defaultPort?: PortInfo;

  serialiseViewData(
    context: CocoonNodeContext<any, ViewDataType, ViewStateType>,
    data: any,
    state: ViewStateType
  ): Promise<ViewDataType | null>;

  respondToQuery?(
    context: CocoonNodeContext<any, ViewDataType, ViewStateType>,
    data: any,
    query: ViewQueryType
  ): ViewQueryResponseType;
}

export type CocoonViewComponent = (props: CocoonViewProps) => JSX.Element;

export interface ViewStateWithRowSelection {
  selectedRows?: number[] | null;
}

export interface ViewStateWithRangeSelection {
  selectedRanges?: {
    [dimension: string]: [number, number];
  } | null;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Misc
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export type DebugFunction = (message: string, ...args: any[]) => void;

export interface CocoonRegistry {
  nodes: {
    [nodeType: string]: CocoonNode | undefined;
  };

  views: {
    [viewType: string]: CocoonView | undefined;
  };
}

export enum ProcessName {
  Unknown = 'unknown',
  Cocoon = 'cocoon',
  CocoonEditor = 'cocoon-editor',
  CocoonEditorHTTP = 'cocoon-editor-http',
  CocoonEditorUI = 'cocoon-editor-ui',
}

export interface Position {
  x: number;
  y: number;
}

export interface GridPosition {
  col: number;
  row: number;
}
