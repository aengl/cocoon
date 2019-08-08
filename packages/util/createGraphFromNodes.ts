import { GraphNode, Graph } from '@cocoon/types';

export default function(nodes: GraphNode[]) {
  const graph: Graph = {
    map: new Map(),
    nodes,
  };
  graph.nodes.forEach(node => graph.map.set(node.id, node));
  return graph;
}
