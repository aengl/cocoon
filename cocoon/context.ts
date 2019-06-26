import { graphNodeRequiresCocoonNode } from '@cocoon/shared/graph';
import {
  CocoonDefinitionsInfo,
  CocoonNodeContext,
  Graph,
  GraphNode,
} from '@cocoon/types';
import Debug from 'debug';
import { copy, readFromPorts, writeToPorts } from './nodes';

const contextModules = {
  fs: require('./fs'),
  process: require('./process'),
  uri: require('./uri'),
};

export function createNodeContext<T, U, V>(
  definitions: CocoonDefinitionsInfo,
  graph: Graph,
  graphNode: GraphNode<T, U, V>,
  invalidate: CocoonNodeContext['invalidate'],
  progress: CocoonNodeContext['progress']
): CocoonNodeContext<T, U, V> {
  return {
    ...contextModules,
    debug: Debug(`cocoon:${graphNode.id}`),
    definitions,
    graph,
    graphNode,
    invalidate,
    ports: createPortsModuleForContext(graph, graphNode),
    progress,
  };
}

function createPortsModuleForContext<T, U, V>(
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
