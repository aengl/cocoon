import {
  CocoonNode,
  CocoonNodeContext,
  Graph,
  GraphNode,
  NodeCache,
} from '@cocoon/types';
import _ from 'lodash';

/**
 * Creates a minimal Cocoon environment for testing nodes. It will run the nodes
 * processing function with a simulated context and return the cached output
 * ports.
 * @param cocoonNode The node to test.
 * @param ports Input port values.
 */
export async function testNode(
  cocoonNode: CocoonNode<any, any, any>,
  ports: NodeCache['ports']
) {
  const graphNode: GraphNode = {
    definition: {
      type: 'Test',
    },
    edgesIn: [],
    edgesOut: [],
    id: 'Test',
    state: {
      cache: {
        ports: {},
      },
    },
  };
  const graph: Graph = {
    map: new Map([[graphNode.definition.type, graphNode]]),
    nodes: [graphNode],
  };
  const context: CocoonNodeContext = {
    debug: () => {
      return;
    },
    definitions: {
      path: '/test.yml',
      raw: '',
      root: '/',
    },
    fs: require('../cocoon/fs'),
    graph,
    graphNode,
    invalidate: () => {},
    ports: {
      read: () => ports,
      write: value => {
        graphNode.state.cache = {
          ...graphNode.state.cache,
          ports: value,
        };
      },
    },
    process: {
      runProcess: async () => {
        return;
      },
    },
    // TODO: needs access to createTemporaryNodeProcessor()
    processTemporaryNode: undefined as any,
    progress: () => {
      return;
    },
    registry: {
      nodes: {},
      views: {},
    },
    uri: require('../cocoon/uri'),
  };
  await cocoonNode.process(context);
  return graphNode.state.cache!.ports;
}