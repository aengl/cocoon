import { Graph } from '@cocoon/types';

export default function(nodeId: string, graph: Graph) {
  const node = graph.map.get(nodeId);
  if (node === undefined) {
    throw new Error(`no node in graph with the id "${nodeId}"`);
  }
  return node;
}
