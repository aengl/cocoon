import _ from 'lodash';
import {
  CocoonDefinitions,
  getNodesFromDefinitions,
  NodeDefinition,
  parsePortDefinition,
  parseViewDefinition,
} from './definitions';
import { GridPosition } from './math';
import { lookupNodeObject, NodeObject, NodeRegistry } from './node';

export enum NodeStatus {
  'processing',
  'processed',
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
  viewDataId?: number;
}

export interface GraphNode<ViewDataType = any, ViewStateType = any> {
  definition: NodeDefinition<ViewStateType>;
  edgesIn: GraphEdge[];
  edgesOut: GraphEdge[];
  hot?: boolean;
  id: string; // alias for `definition.id`, for convenience
  nodeObj?: NodeObject<ViewDataType, ViewStateType>;
  pos: Partial<GridPosition>;
  state: GraphNodeState<ViewDataType>;
  syncId?: number;
  view?: string;
  viewPort?: PortInfo;
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
  definition: NodeDefinition,
  nodeRegistry: NodeRegistry
) {
  const node: GraphNode = {
    definition,
    edgesIn: [],
    edgesOut: [],
    id,
    nodeObj: nodeRegistry[definition.type],
    pos: {
      col: definition.col,
      row: definition.row,
    },
    state: {},
  };
  // Make sure
  // TODO: move this to definitions.ts once we have proper schema validation
  if (id.indexOf('/') >= 0) {
    throw new Error(`disallowed symbol "/" in node id "${id}"`);
  }
  // Parse and assign view definition
  if (definition.view !== undefined) {
    const viewInfo = parseViewDefinition(definition.view);
    node.view = viewInfo === undefined ? definition.view : viewInfo.type;
    node.viewPort = viewInfo === undefined ? undefined : viewInfo.port;
  }
  return node;
}

export function nodeIsCached(node: GraphNode) {
  return !_.isNil(node.state.cache);
}

export function nodeHasState(node: GraphNode) {
  return Object.keys(node.state).length > 0;
}

export function nodeNeedsProcessing(node: GraphNode) {
  return node.state.status !== NodeStatus.processed;
}

export function createGraphFromDefinitions(
  definitions: CocoonDefinitions,
  nodeRegistry: NodeRegistry
): Graph {
  const nodes = getNodesFromDefinitions(definitions).map(({ definition, id }) =>
    createNodeFromDefinition(id, definition, nodeRegistry)
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
  if (node.definition.in !== undefined) {
    const portsIn = node.definition.in;
    // Assign incoming edges to the node
    node.edgesIn = _.flatten(
      Object.keys(portsIn).map(key => {
        // A port input definition may be any value, but can contain one or more
        // port definitions (of the form cocoon://...). We have to try and parse
        // all values and filter out everything that couldn't be parsed
        // afterwards.
        const inDefinitions = _.castArray(portsIn![key]);
        return inDefinitions.map(definition => {
          const result = parsePortDefinition(definition);
          if (result === undefined) {
            return;
          }
          const { id, port } = result;
          if (graph.map.get(id) === undefined) {
            throw Error(
              `${node.id}: unknown node "${id}" in definition "${
                portsIn![key]
              }"`
            );
          }
          return {
            from: graph.map.get(id),
            fromPort: port.name,
            to: node,
            toPort: key,
          };
        });
      })
    ).filter(x => x !== undefined) as GraphEdge[];

    // Find nodes that the edges connect and assign as outgoing edge
    node.edgesIn.forEach(edge => {
      // Make sure we're not adding the edge multiple times
      if (!edge.from.edgesOut.some(edge2 => edge2.to.id === edge.to.id)) {
        edge.from.edgesOut.push(edge);
      }
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
      // TODO: when not defined via definitions, the viewport falls back to a
      // default during node evaluation, which makes it somewhat of a state.
      // Ideally we'd already determine the defaults when creating the graph.
      nextNode.viewPort = node.viewPort;
    }
  });
}

export function nodeIsConnected(node: GraphNode, inputPort: string) {
  return node.edgesIn.some(edge => edge.toPort === inputPort);
}

export function getEdgesForPort(node: GraphNode, portInfo: PortInfo) {
  return portInfo.incoming
    ? node.edgesIn.filter(
        edge => edge.to.id === node.id && edge.toPort === portInfo.name
      )
    : node.edgesOut.filter(
        edge => edge.from.id === node.id && edge.fromPort === portInfo.name
      );
}

export function portIsConnected(node: GraphNode, portInfo: PortInfo) {
  return getEdgesForPort(node, portInfo).length > 0;
}

export function getPortData<T = any>(
  node: GraphNode,
  portInfo: PortInfo
): T | T[] | undefined {
  // Incoming ports retrieve data from connected nodes
  if (portInfo.incoming) {
    // Find edge that is connected to this node and port
    const incomingEdges = getEdgesForPort(node, portInfo);
    if (incomingEdges.length > 0) {
      // Get cached data from the connected port. Data is aggregated into a list
      // (in case of multiple connected edges) and then flattened, so that
      // arrays will be concatenated.
      const data = incomingEdges
        .map(edge => getInMemoryCache<T>(edge.from, edge.fromPort))
        .filter(x => x !== undefined) as T[];
      if (data.length === 0) {
        return;
      }
      return data.length === 1 ? data[0] : _.flatten(data);
    } else {
      // Read static data from the port definition
      const portsIn = node.definition.in;
      if (portsIn !== undefined && portsIn[portInfo.name] !== undefined) {
        return portsIn[portInfo.name] as T;
      }
    }
  }

  // Outgoing ports simply return the cached data
  return getInMemoryCache(node, portInfo.name);
}

export function getInMemoryCache<T = any>(node: GraphNode, port: string) {
  if (
    node.state.cache !== undefined &&
    node.state.cache.ports[port] !== undefined
  ) {
    return node.state.cache.ports[port] as T;
  }
  return;
}

export function setPortData(node: GraphNode, port: string, value: any) {
  if (node.state.cache === undefined) {
    node.state.cache = {
      ports: {},
    };
  }
  node.state.cache.ports[port] = value;
}

export function updatePortStats(node: GraphNode) {
  const cache = node.state.cache;
  if (cache !== undefined) {
    Object.keys(cache.ports).forEach(port => {
      if (node.state.portStats === undefined) {
        node.state.portStats = {};
      }
      node.state.portStats[port] = {
        itemCount: _.get(cache.ports[port], 'length'),
      };
    });
  }
}

export function viewStateHasChanged(node: GraphNode, state: object) {
  if (!node.definition.viewState) {
    return true;
  }
  return Object.keys(state).some(
    key => !stateEntryIsEqual(node.definition.viewState[key], state[key])
  );
}

export function updateViewState(node: GraphNode, state: object) {
  const newState = node.definition.viewState
    ? _.assign({}, node.definition.viewState || {}, state)
    : state;
  // Client may send `null` to overwrite a state, but we don't want to
  // serialise those null values
  node.definition.viewState = _.omitBy(newState, _.isNil);
}

export function findMissingNodeObjects(registry: NodeRegistry, graph: Graph) {
  return graph.nodes
    .map(node => ({
      obj: lookupNodeObject(node, registry),
      type: node.definition.type,
    }))
    .filter(x => x.obj === undefined)
    .map(x => x.type);
}

function stateEntryIsEqual(obj1: object, obj2: object) {
  return (
    (Boolean(obj1) === false && Boolean(obj2) === false) ||
    _.isEqual(obj1, obj2)
  );
}
