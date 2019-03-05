import { Graph, GraphNode, portIsConnected } from '../../common/graph';
import { listPorts, NodeObject } from '../../common/node';
import { translate } from './svg';

const createPositionKey = (node: GraphNode) =>
  `${node.pos.col}/${node.pos.row}`;
const hasPosition = (node: GraphNode) =>
  node.definition.col !== undefined || node.definition.row !== undefined;

export interface PositionData {
  [nodeId: string]: {
    node: ReturnType<typeof calculateNodePosition>;
    overlay: ReturnType<typeof calculateOverlayBounds>;
    ports: ReturnType<typeof calculatePortPositions>;
  };
}

export function calculateNodePosition(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number
) {
  const tx = translate(gridX * gridWidth);
  const ty = translate(gridY * gridHeight);
  return { x: tx(gridWidth / 2), y: ty(gridHeight / 4) + 20 };
}

export function calculatePortPositions(
  node: GraphNode,
  nodeObj: NodeObject,
  nodeX: number,
  nodeY: number
) {
  const inPorts = listPorts(nodeObj, true).filter(
    // Only show ports that are not hidden (unless connected)
    port => !nodeObj.in[port.name].hide || portIsConnected(node, port)
  );
  const outPorts = listPorts(nodeObj, false);
  const offsetX = 22;
  const availableHeight = 50;
  const inStep = 1 / (inPorts.length + 1);
  const outStep = 1 / (outPorts.length + 1);
  const tx = translate(nodeX);
  const ty = translate(nodeY);
  return {
    in: inPorts.map((port, i) => {
      const y = (i + 1) * inStep;
      return {
        name: port.name,
        x: tx(-offsetX + Math.cos(y * 2 * Math.PI) * 3),
        y: ty(y * availableHeight - availableHeight / 2),
      };
    }),
    out: outPorts.map((port, i) => {
      const y = (i + 1) * outStep;
      return {
        name: port.name,
        x: tx(offsetX - Math.cos(y * 2 * Math.PI) * 3),
        y: ty(y * availableHeight - availableHeight / 2),
      };
    }),
  };
}

export function calculateOverlayBounds(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number
) {
  const tx = translate(gridX * gridWidth);
  const ty = translate(gridY * gridHeight);
  return {
    height: gridHeight / 2,
    width: gridWidth,
    x: tx(0),
    y: ty(gridHeight / 2),
  };
}

export function calculateAutomatedLayout(graph: Graph) {
  // Reset all positions
  graph.nodes.forEach(node => {
    node.pos = {};
  });

  // Starting nodes are nodes with no incoming edges
  const startNode = graph.nodes.filter(node => node.edgesIn.length === 0);
  let row = 0;
  startNode.forEach(node => {
    positionNode(node, 0, row);
    // Increase row only if the node was placed where we expected it; if it was
    // not, it had a pre-defined position, so we should re-use that spot
    if (node.pos.row === row && node.pos.col === 0) {
      row += 1;
    }
    // Recursively position connected nodes
    positionConnectedNodes(node, graph);
  });

  // Build a map of all positions
  const positionTable: Map<string, GraphNode> = new Map();
  graph.nodes.forEach(node => {
    const key = createPositionKey(node);
    // Nodes with pre-defined position take priority
    if (hasPosition(node) || positionTable.get(key) === undefined) {
      positionTable.set(key, node);
    }
  });

  // Resolve collisions for nodes without pre-defined positions
  graph.nodes
    .filter(node => !hasPosition(node))
    .forEach(node => {
      while (true) {
        const collidingNode = positionTable.get(createPositionKey(node));
        if (collidingNode === undefined || collidingNode.id === node.id) {
          break;
        }
        node.pos.row! += 1;
      }
      positionTable.set(createPositionKey(node), node);
    });

  return graph;
}

function positionConnectedNodes(node: GraphNode, graph: Graph) {
  // Find nodes that share an edge with the current node
  const connectedNodes = graph.nodes.filter(
    n => n.edgesIn.find(e => e.from.id === node.id) !== undefined
  );

  if (connectedNodes) {
    // If a node has two or more outgoing edges, it's a good heuristic to move
    // up a single row in order to avoid drifting downwards
    const rowOffset = node.edgesOut.length > 1 && node.pos.row! > 0 ? -1 : 0;

    // Position all connected nodes in a single column, next to the current node
    connectedNodes.forEach((n, i) => {
      positionNode(n, node.pos.col! + 1, node.pos.row! + i + rowOffset);
      positionConnectedNodes(n, graph);
    });
  }
}

function positionNode(node: GraphNode, col: number, row: number) {
  // If the node already has been positioned, the rightmost position wins
  if (node.pos.col === undefined || node.pos.col < col) {
    node.pos.col =
      node.definition.col === undefined ? col : node.definition.col;
    node.pos.row =
      node.definition.row === undefined ? row : node.definition.row;
  }
}
