// tslint:disable-next-line:no-implicit-dependencies
import _ from 'lodash';

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

import { Graph, GraphNode, NodeCache } from '../common/graph';
import { CocoonNode, CocoonNodeContext } from '../common/node';

export { CocoonNode };

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Views
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

import {
  CocoonView,
  CocoonViewContext,
  getSupportedViewStates,
  viewStateIsSupported,
  filterUnsupportedViewStates,
  syncViewState,
} from '../common/view';

type FilterRowsViewState = import('../core/nodes/filter/FilterRows').ViewState;
type FilterRangesViewState = import('../core/nodes/filter/FilterRanges').ViewState;

export {
  CocoonView,
  CocoonViewContext,
  getSupportedViewStates,
  viewStateIsSupported,
  filterUnsupportedViewStates,
  syncViewState,
};

// These types are used to interact with filter nodes
export { FilterRowsViewState, FilterRangesViewState };

// Helper functions

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Testing
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

/**
 * Creates a minimal Cocoon environment for testing nodes. It will run the nodes
 * processing function with a simulated context and return the cached output
 * ports.
 * @param cocoonNode The node to test.
 * @param ports Input port values.
 */
export async function testNode(
  cocoonNode: CocoonNode,
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
    fs: require('../core/fs'),
    graph,
    graphNode,
    ports: {
      copy: _.cloneDeep,
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
    progress: () => {
      return;
    },
    uri: require('../core/uri'),
  };
  await cocoonNode.process(context);
  return graphNode.state.cache!.ports;
}
