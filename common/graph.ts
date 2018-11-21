import _ from 'lodash';
import {
  CocoonDefinitions,
  getNodesFromDefinitions,
  NodeDefinition,
  parsePortDefinition,
  parseViewDefinition,
} from './definitions';
import { GridPosition } from './math';

export enum NodeStatus {
  'processing',
  'processed',
  'cached',
  'error',
}

export interface NodeCache {
  ports: { [outPort: string]: any };
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
  status?: NodeStatus;
  summary?: string;
  viewData?: ViewDataType;
}

export interface GraphNode<ViewDataType = any, ViewStateType = any> {
  definition: NodeDefinition;
  description?: string;
  edgesIn: GraphEdge[];
  edgesOut: GraphEdge[];
  hot?: boolean;
  id: string;
  in?: { [id: string]: any };
  pos: Partial<GridPosition>;
  state: GraphNodeState<ViewDataType>;
  type: string;
  view?: string;
  viewPort?: PortInfo;
  viewState?: ViewStateType;
}

export interface GraphEdge {
  from: GraphNode;
  fromPort: string;
  to: GraphNode;
  toPort: string;
}

export interface Graph {
  nodes: GraphNode[];
  map: Map<string, GraphNode>;
}

const randomId = () =>
  Math.random()
    .toString(36)
    .substring(2, 7);

export function createNodeFromDefinition(
  id: string,
  definition: NodeDefinition
) {
  const node: GraphNode = {
    definition,
    description: definition.description,
    edgesIn: [],
    edgesOut: [],
    id,
    in: definition.in,
    pos: {
      col: definition.col,
      row: definition.row,
    },
    state: {},
    type: definition.type,
    view: definition.view,
    viewState: definition.viewState,
  };
  // Parse and assign view definition
  if (definition.view !== undefined) {
    const viewInfo = parseViewDefinition(definition.view);
    node.view = viewInfo === undefined ? definition.view : viewInfo.type;
    node.viewPort =
      viewInfo === undefined
        ? undefined
        : {
            incoming: viewInfo.portIsIncoming,
            name: viewInfo.port,
          };
  }
  return node;
}

export function nodeIsCached(node: GraphNode) {
  return node.state === null ? false : node.state.cache !== null;
}

export function createGraphFromDefinitions(
  definitions: CocoonDefinitions
): Graph {
  const nodes = getNodesFromDefinitions(definitions).map(({ definition, id }) =>
    createNodeFromDefinition(id, definition)
  );
  return createGraphFromNodes(nodes);
}

export function createGraphFromNodes(nodes: GraphNode[]) {
  const graph: Graph = {
    map: new Map(),
    nodes,
  };
  graph.nodes.forEach(node => graph.map.set(node.id, node));
  graph.nodes.forEach(node => {
    createEdgesForNode(node, graph);
  });
  return graph;
}

export function createEdgesForNode(node: GraphNode, graph: Graph) {
  node.edgesIn = [];
  if (node.in !== undefined) {
    // Assign incoming edges to the node
    node.edgesIn = Object.keys(node.in)
      .map(key => {
        const result = parsePortDefinition(node.in![key]);
        if (result === undefined) {
          return;
        }
        const { id, port } = result;
        if (graph.map.get(id) === undefined) {
          throw Error(
            `${node.id}: unknown node "${id}" in definition "${node.in![key]}"`
          );
        }
        return {
          from: graph.map.get(id),
          fromPort: port,
          to: node,
          toPort: key,
        };
      })
      .filter(x => x !== undefined) as GraphEdge[];

    // Find nodes that the edges connect and assign as outgoing edge
    node.edgesIn.forEach(edge => {
      edge.from.edgesOut.push(edge);
    });
  }
}

export function requireNode(nodeId: string, graph: Graph) {
  const node = graph.map.get(nodeId);
  if (node === undefined) {
    throw new Error(`no node in graph with the id "${nodeId}"`);
  }
  return node;
}

export function findPath(node: GraphNode) {
  const path = resolveUpstream(node, n => _.isNil(n.state.cache));
  return _.uniqBy(path, 'id');
}

export function findNodeAtPosition(pos: GridPosition, graph: Graph) {
  return graph.nodes.find(n => n.pos.row === pos.row && n.pos.col === pos.col);
}

export function resolveUpstream(
  node: GraphNode,
  predicate?: (node: GraphNode) => boolean
): GraphNode[] {
  if (predicate && !predicate(node)) {
    return [];
  }
  return _.uniqBy(
    _.concat(
      [],
      ...node.edgesIn.map(edge => resolveUpstream(edge.from, predicate)),
      [node]
    ),
    'id'
  );
}

export function resolveDownstream(
  node: GraphNode,
  predicate?: (node: GraphNode) => boolean
): GraphNode[] {
  if (predicate && !predicate(node)) {
    return [];
  }
  return _.uniqBy(
    _.concat(
      [node],
      ...node.edgesOut.map(edge => resolveDownstream(edge.to, predicate))
    ),
    'id'
  );
}

export function createUniqueNodeId(graph: Graph, prefix: string) {
  while (true) {
    const id = `${prefix}_${randomId()}`;
    // Make sure there are no collisions
    if (!graph.map.has(id)) {
      return id;
    }
  }
}

export function transferGraphState(previousGraph: Graph, nextGraph: Graph) {
  previousGraph.nodes.forEach(node => {
    // Find nodes with matching id
    const nextNode = nextGraph.map.get(node.id);
    if (nextNode !== undefined) {
      // Transfer everything that is not serialised via definitions
      nextNode.hot = node.hot;
      nextNode.state = node.state;
    }
  });
}

export function nodeIsConnected(node: GraphNode, inputPort: string) {
  return node.edgesIn.some(edge => edge.toPort === inputPort);
}

export function getPortData<T = any>(
  node: GraphNode,
  portInfo: PortInfo
): T | undefined {
  // Incoming ports retrieve data from connected nodes
  if (portInfo.incoming) {
    // Find edge that is connected to this node and port
    const incomingEdge = node.edgesIn.find(
      edge => edge.to.id === node.id && edge.toPort === portInfo.name
    );

    if (incomingEdge !== undefined) {
      // Get cached data from the connected port
      const cache = getInMemoryCache(incomingEdge.from, incomingEdge.fromPort);
      if (cache) {
        return cache;
      }
    } else {
      // Read static data from the port definition
      const inDefinitions = node.in;
      if (
        inDefinitions !== undefined &&
        inDefinitions[portInfo.name] !== undefined
      ) {
        return inDefinitions[portInfo.name] as T;
      }
    }
  }

  // Outgoing ports simply return the cached data
  return getInMemoryCache(node, portInfo.name);
}

export function getInMemoryCache(node: GraphNode, port: string) {
  if (
    node.state.cache !== undefined &&
    node.state.cache.ports[port] !== undefined
  ) {
    return node.state.cache.ports[port];
  }
  return;
}

export function setPortData(node: GraphNode, port: string, value: any) {
  if (node.state.cache === undefined) {
    node.state.cache = {
      ports: {},
    };
  }
  if (node.state.portStats === undefined) {
    node.state.portStats = {};
  }
  node.state.cache.ports[port] = _.cloneDeep(value);
  node.state.portStats[port] = {
    itemCount: _.get(value, 'length'),
  };
}

export function updateViewState(node: GraphNode, state: object) {
  node.viewState = node.viewState
    ? _.assign({}, node.viewState || {}, state)
    : state;
}
