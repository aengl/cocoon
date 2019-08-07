import { Graph, GraphNode, IPCContext } from '@cocoon/types';
import createGraphFromNodes from '@cocoon/util/createGraphFromNodes';
import createClient, { WebSocketClient } from '@cocoon/util/ipc/createClient';
import requestCocoonUri from '@cocoon/util/ipc/requestCocoonUri';
import Debug from 'debug';
import WebSocketAsPromised from 'websocket-as-promised';

const state: Partial<IPCContext> = {};

export const cocoonClient = () => state.cocoon!;
export const editorClient = () => state.editor!;
export const ipcContext = () => state as IPCContext;

export const serialiseNode = (node: GraphNode) => ({
  definition: node.definition,
  hot: node.hot,
  id: node.id,
});

export const deserialiseNode = (
  serialisedNode: ReturnType<typeof serialiseNode>
) => serialisedNode as GraphNode;

export const serialiseGraph = (graph: Graph) =>
  graph.nodes.map(node => serialiseNode(node));

export const deserialiseGraph = (
  serialisedGraph: ReturnType<typeof serialiseGraph>
) => createGraphFromNodes(serialisedGraph.map(node => deserialiseNode(node)));

export async function initialiseIPC(
  disconnectCallback: WebSocketClient['disconnectCallback'],
  reconnectCallback: WebSocketClient['reconnectCallback']
) {
  // Connect to the editor process first to query it for the Cocoon address
  state.editor = await createClient(
    WebSocketAsPromised,
    'ws://127.0.0.1:22245',
    Debug('ui:ipc'),
    disconnectCallback,
    reconnectCallback
  );

  // Connect to Cocoon
  const uriResponse = await requestCocoonUri(ipcContext());
  state.cocoon = await createClient(
    WebSocketAsPromised,
    uriResponse.uri || 'ws://127.0.0.1:22244',
    Debug('ui:ipc'),
    disconnectCallback,
    reconnectCallback
  );
}
