import { CocoonNode } from '../../core/graph';

export function assignXY(nodes: CocoonNode[]) {
  // Find starting node
  const startNode = nodes.find(node => node.edgesIn.length === 0);
  positionNode(startNode, 0, 0);

  // Recursively position connected nodes
  positionConnectedNodes(startNode, nodes);

  return nodes;
}

function positionConnectedNodes(node: CocoonNode, nodes: CocoonNode[]) {
  const x = node.definition.x;
  const y = node.definition.y;

  // Find nodes that share an edge with the current node
  const connectedNodes = nodes.filter(
    n =>
      n.edgesIn.find(e => e.from.definition.id === node.definition.id) !==
      undefined
  );

  // Position all connected nodes in a single column, next to the current node
  if (connectedNodes) {
    connectedNodes.forEach((n, i) => {
      positionNode(n, x + 1, y + i);
      positionConnectedNodes(n, nodes);
    });
  }
}

function positionNode(node: CocoonNode, x: number, y: number) {
  node.definition.x = node.definition.x === undefined ? x : node.definition.x;
  node.definition.y = node.definition.y === undefined ? y : node.definition.y;
}
