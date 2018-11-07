import { Graph } from '../../common/graph';
import { CocoonNode } from '../../common/node';

const createPositionKey = (node: CocoonNode) => `${node.col}/${node.row}`;
const hasPositionDefined = (node: CocoonNode) =>
  node.definition.col !== undefined || node.definition.row !== undefined;

export function assignPositions(graph: Graph) {
  // Reset all positions
  graph.nodes.forEach(node => {
    delete node.col;
    delete node.row;
  });

  // Starting nodes are nodes with no incoming edges
  const startNode = graph.nodes.filter(node => node.edgesIn.length === 0);
  let row = 0;
  startNode.forEach(node => {
    positionNode(node, 0, row);
    // Increase row only if the node was placed where we expected it; if it was
    // not, it had a pre-defined position, so we should re-use that spot
    if (node.row === row && node.col === 0) {
      row += 1;
    }
    // Recursively position connected nodes
    positionConnectedNodes(node, graph);
  });

  // Build a map of all positions
  const positionTable: Map<string, CocoonNode> = new Map();
  graph.nodes.forEach(node => {
    const key = createPositionKey(node);
    // Nodes with pre-defined position take priority
    if (hasPositionDefined(node) || positionTable.get(key) === undefined) {
      positionTable.set(key, node);
    }
  });

  // Resolve collisions for nodes without pre-defined positions
  graph.nodes.filter(node => !hasPositionDefined(node)).forEach(node => {
    while (true) {
      const collidingNode = positionTable.get(createPositionKey(node));
      if (collidingNode === undefined || collidingNode.id === node.id) {
        break;
      }
      node.row! += 1;
    }
    positionTable.set(createPositionKey(node), node);
  });

  return graph;
}

function positionConnectedNodes(node: CocoonNode, graph: Graph) {
  // Find nodes that share an edge with the current node
  const connectedNodes = graph.nodes.filter(
    n => n.edgesIn.find(e => e.from.id === node.id) !== undefined
  );

  if (connectedNodes) {
    // If a node has two or more outgoing edges, it's a good heuristic to move
    // up a single row in order to avoid drifting downwards
    const rowOffset = node.edgesOut.length > 1 && node.row! > 0 ? -1 : 0;

    // Position all connected nodes in a single column, next to the current node
    connectedNodes.forEach((n, i) => {
      positionNode(n, node.col! + 1, node.row! + i + rowOffset);
      positionConnectedNodes(n, graph);
    });
  }
}

function positionNode(node: CocoonNode, col: number, row: number) {
  // If the node already has been positioned, the rightmost position wins
  if (node.col === undefined || node.col < col) {
    node.col = node.definition.col === undefined ? col : node.definition.col;
    node.row = node.definition.row === undefined ? row : node.definition.row;
  }
}
