import { CocoonNode } from '../../common/node';

export function assignXY(nodes: CocoonNode[]) {
  // Starting nodes are nodes with no incoming edges
  const startNode = nodes.filter(node => node.edgesIn.length === 0);
  startNode.forEach((n, i) => {
    positionNode(n, 0, i);
    // Recursively position connected nodes
    positionConnectedNodes(n, nodes);
  });
  return nodes;
}

function positionConnectedNodes(node: CocoonNode, nodes: CocoonNode[]) {
  // Find nodes that share an edge with the current node
  const connectedNodes = nodes.filter(
    n => n.edgesIn.find(e => e.from.id === node.id) !== undefined
  );

  // Position all connected nodes in a single column, next to the current node
  if (connectedNodes) {
    connectedNodes.forEach((n, i) => {
      positionNode(n, node.col + 1, node.row + i);
      positionConnectedNodes(n, nodes);
    });
  }
}

function positionNode(node: CocoonNode, x: number, y: number) {
  // If the node already has been positioned, the rightmost position wins
  if (node.col === undefined || node.col < x) {
    node.col = node.definition.col === undefined ? x : node.definition.col;
    node.row = node.definition.row === undefined ? y : node.definition.row;
  }
}
