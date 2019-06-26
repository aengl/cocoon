import { graphNodeRequiresCocoonNode } from '@cocoon/shared/graph';
import { requireCocoonNode } from '@cocoon/shared/registry';
import {
  CocoonDefinitionsInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
} from '@cocoon/types';
import Debug from 'debug';
import { readFromPorts, writeToPorts } from './nodes';

const contextModules = {
  fs: require('./fs'),
  process: require('./process'),
  uri: require('./uri'),
};

export function createNodeContext<T, U, V>(
  definitions: CocoonDefinitionsInfo,
  registry: CocoonRegistry,
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
    registry,
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
