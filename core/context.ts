import Debug from 'debug';
import { CocoonDefinitionsInfo } from '../common/definitions';
import { Graph, GraphNode, graphNodeRequiresCocoonNode } from '../common/graph';
import { CocoonNodeContext } from '../common/node';
import { copy, readFromPorts, writeToPorts } from './nodes';

export const contextModules = {
  fs: require('./fs'),
  process: require('./process'),
  uri: require('./uri'),
};

export function createPortsModuleForContext<T, U, V>(
  graph: Graph,
  graphNode: GraphNode<T, U, V>
) {
  return {
    copy,
    read: readFromPorts.bind(
      null,
      graphNode,
      graph,
      graphNodeRequiresCocoonNode(graphNode).in
    ) as () => T,
    write: writeToPorts.bind(null, graphNode),
  };
}

export function createNodeContext<T, U, V>(
  definitions: CocoonDefinitionsInfo,
  graph: Graph,
  graphNode: GraphNode<T, U, V>,
  progress: CocoonNodeContext['progress']
): CocoonNodeContext<T, U, V> {
  return {
    ...contextModules,
    debug: Debug(`core:${graphNode.id}`),
    definitions,
    graph,
    graphNode,
    ports: createPortsModuleForContext(graph, graphNode),
    progress,
  };
}
