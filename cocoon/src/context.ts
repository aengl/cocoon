import { graphNodeRequiresCocoonNode } from '@cocoon/shared/graph';
import { requireCocoonNode } from '@cocoon/shared/registry';
import {
  CocoonDefinitionsInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
  PortData,
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
  const context: CocoonNodeContext<T, U, V> = {
    ...contextModules,
    debug: Debug(`cocoon:${graphNode.id}`),
    definitions,
    graph,
    graphNode,
    invalidate,
    ports: {
      read: readFromPorts.bind(
        null,
        graphNode,
        graph,
        graphNodeRequiresCocoonNode(graphNode).in
      ) as () => T,
      write: writeToPorts.bind(null, graphNode),
    },
    processTemporaryNode: undefined as any,
    progress,
    registry,
  };
  context.processTemporaryNode = createTemporaryNodeProcessor(
    registry,
    context
  );
  return context;
}

function createTemporaryNodeProcessor(
  registry: CocoonRegistry,
  context: CocoonNodeContext
) {
  return async (nodeType, portData) => {
    if (nodeType === context.graphNode.definition.type) {
      throw new Error(`a node can not be a composite of itself`);
    }
    const outputData = {} as PortData;
    await requireCocoonNode(registry, nodeType).process({
      ...context,
      ports: {
        read: () => portData,
        write: data => {
          Object.assign(outputData, data);
        },
      },
      processTemporaryNode: createTemporaryNodeProcessor(registry, context),
      progress: () => {},
    });
    return outputData;
  };
}
