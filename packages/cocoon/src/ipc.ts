import { CocoonNode, Graph, GraphNode, IPCContext } from '@cocoon/types';
import createGraphFromNodes from '@cocoon/util/createGraphFromNodes';
import _ from 'lodash';
import { serializeError } from 'serialize-error';

const state: Partial<IPCContext> = {};

export const cocoonClient = () => state.cocoon!;
export const editorClient = () => state.editor!;
export const ipcContext = () => state as IPCContext;

export const serialiseCocoonNode = (cocoonNode: CocoonNode) =>
  _.omitBy(cocoonNode, _.isFunction);

export const serialiseNode = (node: GraphNode) => ({
  ...node,
  cocoonNode:
    node.cocoonNode === undefined
      ? undefined
      : serialiseCocoonNode(node.cocoonNode),
  state: {
    ...node.state,
    // Reduce cache information to a boolean
    cache: node.state.cache
      ? Object.keys(node.state.cache).reduce((cache, key) => {
          cache[key] = true;
          return cache;
        }, {})
      : undefined,
    // Serialise error
    error:
      node.state.error === undefined
        ? undefined
        : serializeError(node.state.error),
    // Reduce processor to a boolean
    processor: Boolean(node.state.processor),
    // Reduce view data to a boolean
    viewData: Boolean(node.state.viewData),
  },
});

export const deserialiseNode = (
  serialisedNode: ReturnType<typeof serialiseNode>
) => (serialisedNode as unknown) as GraphNode;

export const serialiseGraph = (graph: Graph) =>
  graph.nodes.map(node => serialiseNode(node));

export const deserialiseGraph = (
  serialisedGraph: ReturnType<typeof serialiseGraph>
) => createGraphFromNodes(serialisedGraph.map(node => deserialiseNode(node)));
