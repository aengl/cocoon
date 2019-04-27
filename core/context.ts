import Debug from 'debug';
import { CocoonDefinitionsInfo } from '../common/definitions';
import { Graph, GraphNode } from '../common/graph';
import { CocoonNodeContext, CocoonRegistry } from '../common/node';
import { copy, readFromPorts, writeToPorts } from './nodes';
import { getCocoonNodeFromGraphNode } from './registry';

export const contextModules = {
  fs: require('./fs'),
  process: require('./process'),
  uri: require('./uri'),
};

export function createPortsModuleForContext<T, U, V>(
  registry: CocoonRegistry,
  graph: Graph,
  graphNode: GraphNode<T, U, V>
) {
  const cocoonNode = getCocoonNodeFromGraphNode(registry, graphNode);
  return {
    copy,
    read: readFromPorts.bind(
      null,
      registry,
      graphNode,
      graph,
      cocoonNode.in
    ) as () => T,
    write: writeToPorts.bind(null, graphNode),
  };
}

export function createNodeContext<T, U, V>(
  definitions: CocoonDefinitionsInfo,
  graph: Graph,
  graphNode: GraphNode<T, U, V>,
  registry: CocoonRegistry,
  progress: CocoonNodeContext['progress']
): CocoonNodeContext<T, U, V> {
  return {
    ...contextModules,
    debug: Debug(`core:${graphNode.id}`),
    definitions,
    graph,
    graphNode,
    ports: createPortsModuleForContext(registry, graph, graphNode),
    progress,
  };
}
