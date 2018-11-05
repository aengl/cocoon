import fs from 'fs';
import _ from 'lodash';
import serializeError from 'serialize-error';
import Debug from '../common/debug';
import {
  parseCocoonDefinitions,
  updateNodesInDefinitions,
} from '../common/definitions';
import {
  onCreateNode,
  onEvaluateNode,
  onNodeSync,
  onNodeViewQuery,
  onNodeViewStateChanged,
  onOpenDefinitions,
  onPortDataRequest,
  onUpdateDefinitions,
  sendCoreMemoryUsage,
  sendError,
  sendGraphChanged,
  sendNodeProgress,
  sendNodeSync,
  sendNodeViewQueryResponse,
  sendPortDataResponse,
  serialiseNode,
  updatedNode,
} from '../common/ipc';
import { CocoonNode, NodeStatus } from '../common/node';
import { readFile, writeYamlFile } from './fs';
import {
  createGraph,
  createUniqueNodeId,
  findNode,
  findPath,
  resolveDownstream,
  tryFindNode,
} from './graph';
import {
  getNode,
  NodeContext,
  readFromPort,
  readPersistedCache,
  writePersistedCache,
  writeToPort,
} from './nodes';

const debug = Debug('core:index');

process.on('unhandledRejection', e => {
  throw e;
});

process.on('uncaughtException', error => {
  sendError({ error: serializeError(error) });
});

export async function evaluateNodeById(nodeId: string) {
  const { graph } = global;
  const targetNode = findNode(graph, nodeId);
  return evaluateNode(targetNode);
}

export async function evaluateNode(targetNode: CocoonNode) {
  // Figure out the evaluation path
  debug(`running graph to generate results for node "${targetNode.id}"`);
  const path = findPath(targetNode);
  if (path.length === 0) {
    // If all upstream nodes are cached or the node is a starting node, the path
    // will be an empty array. In that case, re-evaluate the target node only.
    path.push(targetNode);
  }
  if (path.length > 1) {
    debug(path.map(n => n.id).join(' -> '));
  }

  // Clear downstream cache
  const downstreamNodes = resolveDownstream(targetNode);
  downstreamNodes.forEach(node => {
    if (node.id !== targetNode.id) {
      delete node.cache;
      delete node.summary;
      delete node.error;
      delete node.viewData;
      node.status = NodeStatus.unprocessed;
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  });

  // Process nodes
  debug(`processing ${path.length} node(s)`);
  for (const node of path) {
    await evaluateSingleNode(node);
  }

  // Re-evaluate affected hot nodes
  //
  // TODO: If there's a hot node that's downstream of another hot node we'll
  // probably run into trouble. We should have a graph function to calculate a
  // path through multiple nodes and execute it.
  for (const node of downstreamNodes.filter(n => n.hot)) {
    if (node.id !== targetNode.id) {
      await evaluateNode(node);
    }
  }
}

async function evaluateSingleNode(node: CocoonNode) {
  debug(`evaluating node "${node.id}"`);
  const nodeObj = getNode(node.type);
  try {
    delete node.error;
    delete node.summary;
    delete node.viewData;
    node.status = NodeStatus.unprocessed;
    const context = createNodeContext(node);

    // Process node
    if (nodeObj.process) {
      node.status = NodeStatus.processing;
      sendNodeSync({ serialisedNode: serialiseNode(node) });
      context.debug(`processing`);
      const result = await nodeObj.process(context);
      if (_.isString(result)) {
        node.summary = result;
      } else if (!_.isNil(result)) {
        node.viewData = result;
      }
      node.status =
        node.cache === null ? NodeStatus.unprocessed : NodeStatus.cached;
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }

    // Create rendering data
    if (nodeObj.serialiseViewData) {
      context.debug(`serialising rendering data`);
      node.viewData = nodeObj.serialiseViewData(context, node.viewState);
      sendNodeSync({ serialisedNode: serialiseNode(node) });
    }
  } catch (error) {
    debug(`error in node "${node.id}"`);
    debug(error);
    node.status = NodeStatus.error;
    node.error = error;
    sendNodeSync({ serialisedNode: serialiseNode(node) });
  }
}

async function parseDefinitions(definitionsPath: string) {
  debug(`parsing Cocoon definitions file at "${definitionsPath}"`);
  const definitions = await readFile(definitionsPath);

  // Load definitions and create graph
  global.definitionsPath = definitionsPath;
  global.definitions = parseCocoonDefinitions(definitions);
  global.graph = createGraph(global.definitions);
  sendGraphChanged({
    definitions,
    definitionsPath,
  });
}

function createNodeContext(node: CocoonNode): NodeContext {
  return {
    config: node.config || {},
    debug: Debug(`core:${node.id}`),
    definitions: global.definitions,
    definitionsPath: global.definitionsPath,
    node,
    progress: (summary, percent) => {
      sendNodeProgress(node.id, { summary, percent });
    },
    readFromPort: readFromPort.bind(null, node),
    readPersistedCache: readPersistedCache.bind(null, node),
    writePersistedCache: writePersistedCache.bind(null, node),
    writeToPort: writeToPort.bind(null, node),
  };
}

function unwatchDefinitionsFile() {
  const { definitionsPath } = global;
  if (definitionsPath) {
    debug(`removing watch for "${definitionsPath}"`);
    fs.unwatchFile(global.definitionsPath);
  }
}

function watchDefinitionsFile() {
  const { definitionsPath } = global;
  debug(`watching "${definitionsPath}"`);
  fs.watchFile(definitionsPath, { interval: 500 }, () => {
    debug(`definitions file at "${definitionsPath}" was modified`);
    parseDefinitions(definitionsPath);
  });
}

async function updateDefinitions() {
  debug(`updating definitions`);
  const { definitions, graph } = global;
  // TODO: this is a mess; the graph should just have the original definitions
  // linked, so this entire step should be redundant!
  updateNodesInDefinitions(definitions, nodeId => {
    const node = tryFindNode(graph, nodeId);
    return node ? node.definition : node;
  });
  unwatchDefinitionsFile();
  const definitionsContent = await writeYamlFile(
    global.definitionsPath,
    definitions,
    undefined,
    debug
  );
  watchDefinitionsFile();
  return definitionsContent;
}

// Respond to IPC requests to open a definition file
onOpenDefinitions(async args => {
  debug(`opening definitions file`);
  unwatchDefinitionsFile();
  await parseDefinitions(args.definitionsPath);
  watchDefinitionsFile();
});

// Respond to IPC requests to update the definition file
onUpdateDefinitions(() => {
  updateDefinitions();
});

// Respond to IPC requests to evaluate a node
onEvaluateNode(args => {
  evaluateNodeById(args.nodeId);
});

// Respond to IPC requests for port data
onPortDataRequest(async args => {
  const { nodeId, port } = args;
  const node = findNode(global.graph, nodeId);
  debug(`got port data request from "${node.id}"`);
  if (!node.cache) {
    await evaluateNode(node);
  }
  if (node.cache) {
    sendPortDataResponse({
      data: node.cache.ports[port],
      request: args,
    });
  }
});

// Sync attribute changes in nodes (i.e. the UI changed a node's state)
onNodeSync(args => {
  const { graph } = global;
  const node = findNode(graph, _.get(args.serialisedNode, 'id'));
  debug(`syncing node "${node.id}"`);
  updatedNode(node, args.serialisedNode);
});

// If the node view state changes (due to interacting with the data view window
// of a node), re-evaluate the node
onNodeViewStateChanged(args => {
  const { nodeId, state } = args;
  const node = findNode(global.graph, nodeId);
  debug(`view state changed for "${node.id}"`);
  if (!_.isEqual(args.state, node.viewState)) {
    node.viewState = node.viewState
      ? _.assign({}, node.viewState || {}, state)
      : state;
    evaluateNode(node);
  }
});

// If the node view issues a query, process it and send the response back
onNodeViewQuery(args => {
  const { nodeId, query } = args;
  const node = findNode(global.graph, nodeId);
  debug(`got view query from "${node.id}"`);
  const nodeObj = getNode(node.type);
  if (nodeObj.respondToQuery) {
    const context = createNodeContext(node);
    const data = nodeObj.respondToQuery(context, query);
    sendNodeViewQueryResponse(nodeId, { data });
  }
});

// The UI wants us to create a new node
onCreateNode(async args => {
  const { definitions, definitionsPath, graph } = global;
  const connectedNode = findNode(global.graph, args.connectedNodeId);
  debug(`creating new node of type "${args.type}"`);
  definitions[connectedNode.group].nodes.push({
    [args.type]: {
      id: createUniqueNodeId(graph, args.type),
      in: {
        [args.connectedPort]: `${args.connectedNodeId}/${
          args.connectedNodePort
        }`,
      },
    },
  });
  await updateDefinitions();
  // TODO: we shouldn't have to parse the entire file again
  parseDefinitions(definitionsPath);
});

// Send memory usage reports
setInterval(() => {
  sendCoreMemoryUsage({ memoryUsage: process.memoryUsage() });
}, 1000);

// Emit ready signal
if (process.send) {
  process.send('ready');
}
