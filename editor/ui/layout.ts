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
      positionNode(n, node.x + 1, node.y + i);
      positionConnectedNodes(n, nodes);
    });
  }
}

function positionNode(node: CocoonNode, x: number, y: number) {
  // If the node already has been positioned, the rightmost position wins
  if (node.x === undefined || node.x < x) {
    node.x = node.definition.x === undefined ? x : node.definition.x;
    node.y = node.definition.y === undefined ? y : node.definition.y;
  }
}
