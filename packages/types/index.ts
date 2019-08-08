/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface CocoonNodeContext<PortDataType extends PortData = any> {
  cocoonFile: CocoonFileInfo;
  debug: DebugFunction;
  graph: Graph;
  graphNode: GraphNode<PortDataType>;
  invalidate: () => void;
  ports: {
    read: () => PortDataType;
    write: (data: PortData) => void;
  };
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

  /**
   * Help text for the port.
   */
  description?: string;

  /**
   * If false, don't show the port in the editor unless a value is assigned or
   * the port is connected.
   */
  visible?: boolean;

  /**
   * The port will throw an error if no data was received.
   */
  required?: boolean;
}

export type Progress = string | number | [string, number] | void;

export interface OutputPort {
  description?: string;
}

export interface CocoonNodePorts<T extends PortData = PortData> {
  in?: {
    [X in keyof T]-?: InputPort;
  };

  out?: {
    [id: string]: OutputPort;
  };
}

export interface CocoonNode<PortDataType extends PortData = any>
  extends CocoonNodePorts<PortDataType> {
  category?: string;
  defaultPort?: PortInfo;
  description?: string;
  persist?: boolean;
  supportedViewStates?: string[];

  process(
    context: CocoonNodeContext<PortDataType>
  ): AsyncIterableIterator<Progress>;

  receive?(context: CocoonNodeContext<PortDataType>, data: any): void;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Graph
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export enum NodeStatus {
  'restoring' = 0,
  'processing' = 1,
  'processed' = 2,
  'error' = 3,
}

export interface PortData {
  [port: string]: any;
}

export interface NodeCache<PortDataType extends PortData = PortData> {
  ports: PortDataType;
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

export interface GraphNode<PortDataType extends PortData = any> {
  cocoonNode?: CocoonNode<PortDataType>;
  definition: CocoonNodeDefinition;
  edgesIn: GraphEdge[];
  edgesOut: GraphEdge[];
  hot?: boolean;
  id: string; // alias for `definition.id`, for convenience
  state: GraphNodeState;
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
 * Cocoon File
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

export interface CocoonFileInfo {
  parsed?: CocoonFile;
  path: string;
  raw: string;
  root: string;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Views
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export interface CocoonViewProps<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  debug: DebugFunction;
  graphNode: GraphNode;
  height?: number;
  highlight: (data: any) => void;
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
  registerHighlight: (
    callback: (args: { data: any; senderNodeId: string }) => void
  ) => void;
  search?: URLSearchParams;
  send: (data: any) => void;
  syncViewState: (state: ViewStateType) => void;
  viewData: ViewDataType;
  viewState: ViewStateType;
  viewPort: PortInfo;
  width?: number;
}

export interface CocoonView<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  component?: string;
  defaultPort?: PortInfo;
  description?: string;
  stateDescriptions?: {
    [X in keyof ViewStateType]-?: string;
  };

  serialiseViewData(
    context: CocoonNodeContext,
    data: any,
    state: ViewStateType
  ): Promise<ViewDataType | null>;

  respondToQuery?(
    context: CocoonNodeContext,
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
 * IPC
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export type IPCCallback<Args = any, Response = any> = (
  args: Args
) => Response | Promise<Response>;

export interface IPCData<T = any> {
  id?: number;
  action?: 'register' | 'unregister';
  channel: string;
  payload: T;
}

export interface IPCClient {
  send(channel: string, payload?: any): void;

  invoke(channel: string, payload?: any): void;

  request<ResponseType = any>(
    channel: string,
    payload?: any,
    callback?: IPCCallback<ResponseType>
  ): Promise<ResponseType>;

  registerCallback<CallbackType extends IPCCallback = IPCCallback>(
    channel: string,
    callback: CallbackType
  ): CallbackType;

  unregisterCallback(channel: string, callback: IPCCallback): void;
}

export interface IPCServer {
  emit(channel: string, payload?: any): void;

  registerCallback<CallbackType extends IPCCallback = IPCCallback>(
    channel: string,
    callback: CallbackType
  ): CallbackType;
}

export interface IPCContext {
  cocoon: IPCClient;
  editor: IPCClient;
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Misc
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export type DebugFunction = (message: string, ...args: any[]) => void;

export interface CocoonRegistry {
  nodeImports: {
    [nodeType: string]: {
      module: string;
      importTimeInMs: number;
    };
  };

  nodes: {
    [nodeType: string]: CocoonNode | undefined;
  };

  viewImports: {
    [viewType: string]: {
      module: string;
      importTimeInMs: number;
      component: string;
    };
  };

  views: {
    [viewType: string]: CocoonView | undefined;
  };
}

export interface Position {
  x: number;
  y: number;
}

export interface GridPosition {
  col: number;
  row: number;
}
