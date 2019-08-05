import {
  CocoonNode,
  CocoonNodeContext,
  Graph,
  GraphNode,
  PortData,
} from '@cocoon/types';
import _ from 'lodash';

/**
 * Creates a minimal Cocoon environment for testing nodes. It will run the nodes
 * processing function with a simulated context and return the cached output
 * ports.
 * @param cocoonNode The node to test.
 * @param ports Input port values.
 */
export async function testNode<PortDataType extends PortData = any>(
  cocoonNode: CocoonNode<PortDataType>,
  ports: PortDataType
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
  const context: CocoonNodeContext<PortDataType> = {
    cocoonFile: {
      path: '/test.yml',
      raw: '',
      root: '/',
    },
    debug: _.noop,
    graph,
    graphNode,
    invalidate: _.noop,
    ports: {
      read: () => ports,
      write: value => {
        graphNode.state.cache = {
          ...graphNode.state.cache,
          ports: value,
        };
      },
    },
    registry: {
      nodeImports: {},
      nodes: {},
      viewImports: {},
      views: {},
    },
  };
  const processor = cocoonNode.process(context);
  for await (const progress of processor) {
    continue;
  }
  return graphNode.state.cache!.ports;
}

/**
 * Like `testNode()`, but returns the input port values along with the ouput
 * port values to make snapshot files more readable.
 * @param cocoonNode The node to test.
 * @param ports Input port values.
 */
export async function snapshotNode<PortDataType extends PortData = any>(
  cocoonNode: CocoonNode<PortDataType>,
  ports: PortDataType
) {
  return {
    in: ports,
    out: await testNode(cocoonNode, ports),
  };
}
