import {
  CocoonFileInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
} from '@cocoon/types';
import Debug from 'debug';
import { graphNodeRequiresCocoonNode } from './graph';
import { readFromPorts, writeToPorts } from './nodes/index';

export function createNodeContext<PortDataType>(
  cocoonFile: CocoonFileInfo,
  registry: CocoonRegistry,
  graph: Graph,
  graphNode: GraphNode<PortDataType>,
  invalidate: CocoonNodeContext['invalidate']
): CocoonNodeContext<PortDataType> {
  return {
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
      ) as () => PortDataType,
      write: writeToPorts.bind(null, graphNode),
    },
    registry,
  };
}
