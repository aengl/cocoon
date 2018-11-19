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

export interface GraphNode<ViewDataType = any, ViewStateType = any>
  extends NodeDefinition {
  definition: NodeDefinition;
  edgesIn: GraphEdge[];
  edgesOut: GraphEdge[];
  id: string;
  state: {
    cache?: NodeCache | null;
    error?: Error | null;
    hot?: boolean | null;
    portStats?: PortStatistics | null;
    status?: NodeStatus | null;
    summary?: string | null;
    viewData?: ViewDataType | null;
    viewState?: ViewStateType | null;
  };
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
  definition: NodeDefinition
) {
  const node: GraphNode = _.assign(
    {
      edgesIn: [],
      edgesOut: [],
      id,
      state: {},
    },
    { definition },
    // Definitions redundantly exist directly in the node object for two
    // reasons: more convenient access (`node.id` vs `node.definition.id`)
    // and temporary changes (assigning col/row for layouting) vs persisted
    // changes (changing the position in the definitions file)
    definition
  );
  // Parse and assign view definition
  if (definition.view !== undefined) {
    const viewInfo = parseViewDefinition(definition.view);
    node.view = viewInfo.type;
    node.viewPort = {
      incoming: viewInfo.portIsIncoming,
      name: viewInfo.port,
    };
  }
  return node;
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
  return graph.nodes.find(n => n.row === pos.row && n.col === pos.col);
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
    const nextNode = nextGraph.map.get(node.id);
    if (nextNode !== undefined) {
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
    !_.isNil(node.state.cache) &&
    node.state.cache.ports[port] !== undefined
  ) {
    return node.state.cache.ports[port];
  }
  return;
}

export function setPortData(node: GraphNode, port: string, value: any) {
  if (_.isNil(node.state.cache)) {
    node.state.cache = {
      ports: {},
    };
  }
  if (_.isNil(node.state.portStats)) {
    node.state.portStats = {};
  }
  node.state.cache.ports[port] = _.cloneDeep(value);
  node.state.portStats[port] = {
    itemCount: _.get(value, 'length'),
  };
}
