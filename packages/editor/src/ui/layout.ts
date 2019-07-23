import { CocoonNode, Graph, GraphNode, GridPosition } from '@cocoon/types';
import listPorts from '@cocoon/util/listPorts';
import _ from 'lodash';
import { translate } from './svg';
import listConnectedEdges from '@cocoon/util/listConnectedEdges';

const positionKey = (pos: Partial<GridPosition>) => `${pos.col}/${pos.row}`;
const hasPosition = (node: GraphNode) =>
  node.definition.editor &&
  (node.definition.editor.col !== undefined ||
    node.definition.editor.row !== undefined);

export interface PositionData {
  maxCol?: number;
  maxRow?: number;
  nodes: {
    [nodeId: string]: {
      col?: number;
      glyph: ReturnType<typeof calculateGlyphPositions>;
      overlay: ReturnType<typeof calculateOverlayBounds>;
      ports: ReturnType<typeof calculatePortPositions>;
      row?: number;
    };
  };
}

export function layoutGraphInGrid(
  graph: Graph,
  gridWidth: number,
  gridHeight: number
): PositionData {
  const positions: PositionData = {
    nodes: graph.nodes.reduce((nodes, node) => {
      nodes[node.id] = {
        col: node.definition.editor ? node.definition.editor.col : undefined,
        row: node.definition.editor ? node.definition.editor.row : undefined,
      };
      return nodes;
    }, {}),
  };
  const nodeIds = Object.keys(positions.nodes);

  // Run automated layouting
  assignNodeGridPositions(positions.nodes, graph);

  // Calculate pixel offsets
  updatePositions(positions, graph, gridWidth, gridHeight);

  // Find maximum row and column
  positions.maxCol = _.max(nodeIds.map(nodeId => positions.nodes[nodeId].col!));
  positions.maxRow = _.max(nodeIds.map(nodeId => positions.nodes[nodeId].row!));

  return positions;
}

export function updatePositions(
  positions: PositionData,
  graph: Graph,
  gridWidth: number,
  gridHeight: number
) {
  graph.nodes.forEach(node => {
    const data = positions.nodes[node.id];
    const { col, row } = data;
    const pos = calculateGlyphPositions(col!, row!, gridWidth, gridHeight);
    data.glyph = pos;
    data.overlay = calculateOverlayBounds(col!, row!, gridWidth, gridHeight);
    if (node.cocoonNode) {
      data.ports = calculatePortPositions(node, node.cocoonNode, pos.x, pos.y);
    }
  });
  return positions;
}

function assignNodeGridPositions(
  nodePositions: PositionData['nodes'],
  graph: Graph
) {
  // Starting nodes are nodes with no incoming edges
  const startNode = graph.nodes.filter(node => node.edgesIn.length === 0);
  let row = 0;
  startNode.forEach(node => {
    positionNode(node, nodePositions, 0, row);
    // Increase row only if the node was placed where we expected it; if it was
    // not, it had a pre-defined position, so we should re-use that spot
    const pos = nodePositions[node.id];
    if (pos.row === row && pos.col === 0) {
      row += 1;
    }
    // Recursively position connected nodes
    positionConnectedNodes(node, nodePositions, graph);
  });

  // Build a map of all positions
  const positionTable: Map<string, GraphNode> = new Map();
  graph.nodes.forEach(node => {
    const key = positionKey(nodePositions[node.id]);
    // Nodes with pre-defined position take priority
    if (hasPosition(node) || positionTable.get(key) === undefined) {
      positionTable.set(key, node);
    }
  });

  // Resolve collisions for nodes without pre-defined positions
  graph.nodes
    .filter(node => !hasPosition(node))
    .forEach(node => {
      const pos = nodePositions[node.id];
      while (true) {
        const collidingNode = positionTable.get(positionKey(pos));
        if (collidingNode === undefined || collidingNode.id === node.id) {
          break;
        }
        pos.row! += 1;
      }
      positionTable.set(positionKey(pos), node);
    });
}

function calculateGlyphPositions(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number
) {
  const tx = translate(gridX * gridWidth);
  const ty = translate(gridY * gridHeight);
  return { x: tx(gridWidth / 2), y: ty(gridHeight / 4) + 20 };
}

function calculatePortPositions(
  node: GraphNode,
  cocoonNode: CocoonNode,
  nodeX: number,
  nodeY: number
) {
  const inPorts = listPorts(cocoonNode, true).filter(
    // Only show ports that are not hidden (unless connected)
    port =>
      !cocoonNode.in[port.name].hide ||
      listConnectedEdges(node, port).length > 0
  );
  const outPorts = listPorts(cocoonNode, false);
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

function calculateOverlayBounds(
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

function positionConnectedNodes(
  node: GraphNode,
  positions: PositionData['nodes'],
  graph: Graph
) {
  const pos = positions[node.id];

  // Find nodes that share an edge with the current node
  const connectedNodes = graph.nodes.filter(
    n => n.edgesIn.find(e => e.from === node.id) !== undefined
  );

  if (connectedNodes) {
    // If a node has two or more outgoing edges, it's a good heuristic to move
    // up a single row in order to avoid drifting downwards
    const rowOffset = node.edgesOut.length > 1 && pos.row! > 0 ? -1 : 0;

    // Position all connected nodes in a single column, next to the current node
    connectedNodes.forEach((n, i) => {
      positionNode(n, positions, pos.col! + 1, pos.row! + i + rowOffset);
      positionConnectedNodes(n, positions, graph);
    });
  }
}

function positionNode(
  node: GraphNode,
  positions: PositionData['nodes'],
  col: number,
  row: number
) {
  const pos = positions[node.id];

  // If the node already has been positioned, the rightmost position wins
  const { editor } = node.definition;
  if (pos.col === undefined || pos.col < col) {
    pos.col = editor && editor.col !== undefined ? editor.col : col;
    pos.row = editor && editor.row !== undefined ? editor.row : row;
  }
}
