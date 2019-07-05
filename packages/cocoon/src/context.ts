import { graphNodeRequiresCocoonNode } from '@cocoon/shared/graph';
import {
  CocoonFileInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
  PortData,
} from '@cocoon/types';
import requireCocoonNode from '@cocoon/util/requireCocoonNode';
import Debug from 'debug';
import { readFromPorts, writeToPorts } from './nodes';

export function createNodeContext<T, U, V>(
  cocoonFile: CocoonFileInfo,
  registry: CocoonRegistry,
  graph: Graph,
  graphNode: GraphNode<T, U, V>,
  invalidate: CocoonNodeContext['invalidate']
): CocoonNodeContext<T, U, V> {
  const context: CocoonNodeContext<T, U, V> = {
    cocoonFile,
    debug: Debug(`cocoon:${graphNode.id}`),
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
    const outputData: PortData = {};
    const processor = requireCocoonNode(registry, nodeType).process({
      ...context,
      ports: {
        read: () => portData,
        write: data => {
          Object.assign(outputData, data);
        },
      },
      processTemporaryNode: createTemporaryNodeProcessor(registry, context),
    });
    for await (const progress of processor) {
      continue;
    }
    return outputData;
  };
}
