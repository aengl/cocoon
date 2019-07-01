import { Debug as DebugShared } from '@cocoon/shared/debug';
import {
  assignPortDefinition,
  assignViewDefinition,
  createNodeDefinition,
  diffDefinitions,
  parseCocoonDefinitions,
  removeNodeDefinition,
  removePortDefinition,
  removeViewDefinition,
} from '@cocoon/shared/definitions';
import {
  createGraphFromDefinitions,
  createUniqueNodeId,
  edgesAreEqual,
  getPortData,
  nodeHasErrorUpstream,
  nodeHasState,
  nodeIsCached,
  nodeNeedsProcessing as _nodeNeedsProcessing,
  requireNode,
  resolveDownstream,
  transferGraphState,
  updateDefinitionsFromGraph,
  updatePortStats,
  updateViewState,
  viewStateHasChanged,
} from '@cocoon/shared/graph';
import {
  deserialiseNode,
  initialiseIPC,
  onChangeNodeViewState,
  onClearPersistedCache,
  onCreateEdge,
  onCreateNode,
  onCreateView,
  onOpenDefinitions,
  onOpenFile,
  onProcessNode,
  onProcessNodeIfNecessary,
  onPurgeCache,
  onQueryNodeView,
  onQueryNodeViewData,
  onRemoveEdge,
  onRemoveNode,
  onRemoveView,
  onRequestDefinitions,
  onRequestMemoryUsage,
  onRequestNodeSync,
  onRequestPortData,
  onRequestRegistry,
  onRunProcess,
  onSendToNode,
  onShiftPositions,
  onSyncNode,
  onUpdateDefinitions,
  sendError,
  sendSyncGraph,
  sendSyncNode,
  sendUpdateDefinitions,
  sendUpdateNodeProgress,
  serialiseGraph,
  serialiseNode,
  setupLogForwarding,
} from '@cocoon/shared/ipc';
import {
  CocoonDefinitions,
  CocoonDefinitionsInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
  NodeStatus,
  ProcessName,
} from '@cocoon/types';
import requireCocoonNode from '@cocoon/util/requireCocoonNode';
import Debug from 'debug';
import fs from 'fs';
import _ from 'lodash';
import open from 'open';
import path from 'path';
import serializeError from 'serialize-error';
import { createNodeContext } from './context';
import { readFile, resolvePath, writeFile, writeYamlFile } from './fs';
import {
  clearPersistedCache,
  nodeHasPersistedCache,
  persistIsEnabled,
  respondToViewQuery,
  restorePersistedCache,
  updateView,
  writePersistedCache,
} from './nodes';
import { appendToExecutionPlan, createAndExecutePlanForNodes } from './planner';
import { runProcess } from './process';
import { createAndInitialiseRegistry } from './registry';

interface State {
  definitionsInfo: CocoonDefinitionsInfo | null;
  graph: Graph | null;
  originalCwd: string;
  previousDefinitionsInfo: CocoonDefinitionsInfo | null;
  registry: CocoonRegistry | null;
}

const debug = require('debug')('cocoon:index');

const watchedFiles = new Set();
const cacheRestoration: Map<string, Promise<any>> = new Map();
const state: State = {
  definitionsInfo: null,
  graph: null,
  originalCwd: process.cwd(),
  previousDefinitionsInfo: null,
  registry: null,
};

export async function openDefinitions(definitionsPath: string) {
  await parseDefinitions(definitionsPath);
  return state.graph!;
}

export async function processNodeById(nodeId: string) {
  const node = requireNode(nodeId, state.graph!);
  await processNode(node);
  return state.graph!;
}

export async function processNodeByIdIfNecessary(nodeId: string) {
  const node = requireNode(nodeId, state.graph!);
  await processNodeIfNecessary(node);
  return state.graph!;
}

export async function processNode(node: GraphNode) {
  // Clear the node cache before creating an execution plan -- otherwise
  // nothing will happen if the node is already cached
  invalidateNodeCacheDownstream(node);
  await createAndExecutePlanForNodes(node, createNodeProcessor, state.graph!, {
    afterPlanning: plan => {
      // Append unprocessed hot nodes to plan
      state
        .graph!.nodes.filter(
          n => n.hot === true && n.state.status === undefined
        )
        .forEach(n => appendToExecutionPlan(plan, n));
    },
    nodeAdded: n => {
      n.state.scheduled = true;
      sendSyncNode({ serialisedNode: serialiseNode(n) });
    },
    nodeNeedsProcessing,
    nodeRemoved: n => {
      n.state.scheduled = false;
      sendSyncNode({ serialisedNode: serialiseNode(n) });
    },
  });
}

export async function processNodeIfNecessary(node: GraphNode) {
  // Additionally to not being processed yet, we require all upstream nodes to
  // be error free. Only explicit processing requests will force error states to
  // be re-evaluated.
  if (nodeNeedsProcessing(node) && !nodeHasErrorUpstream(node, state.graph!)) {
    await createAndExecutePlanForNodes(
      node,
      createNodeProcessor,
      state.graph!,
      { nodeNeedsProcessing }
    );
  }
}

export async function processHotNodes() {
  const unprocessedHotNodes = state.graph!.nodes.filter(
    n => n.hot === true && n.state.status === undefined
  );
  await createAndExecutePlanForNodes(
    unprocessedHotNodes,
    createNodeProcessor,
    state.graph!,
    { nodeNeedsProcessing }
  );
}

export function createNodeContextFromState(node: GraphNode) {
  return createNodeContext(
    state.definitionsInfo!,
    state.registry!,
    state.graph!,
    node,
    () => invalidateNodeCacheDownstream(node),
    _.throttle((summary, percent) => {
      // Check if the node is still processing, otherwise the delayed progress
      // report could come in after the node already finished
      if (node.state.status === NodeStatus.processing) {
        sendUpdateNodeProgress(node.id, { summary, percent });
      }
    }, 200)
  );
}

export async function initialise() {
  // Run IPC server and register IPC events
  await initialiseIPC(ProcessName.Cocoon);
  setupLogForwarding(Debug);
  setupLogForwarding(DebugShared);

  onOpenDefinitions(async args => {
    debug(`opening definitions file at "${args.definitionsPath}"`);
    unwatchDefinitionsFile();

    // Reset state to force a complete graph re-construction
    state.definitionsInfo = null;
    state.graph = null;
    state.registry = null;

    try {
      await openDefinitions(args.definitionsPath);
    } catch (error) {
      throw error;
    } finally {
      if (state.definitionsInfo) {
        // If we at least got the raw definitions (i.e. reading the file was
        // successful), send the definitions to the client
        sendUpdateDefinitions({ definitions: state.definitionsInfo!.raw });
        watchDefinitionsFile();
      }
    }
  });

  onUpdateDefinitions(async args => {
    if (args.definitions) {
      // The client updated the definitions file manually (via the text editor)
      // -- persist the changes and re-build the graph
      unwatchDefinitionsFile();
      await writeFile(state.definitionsInfo!.path, args.definitions);
      watchDefinitionsFile();
    } else {
      await updateDefinitionsAndNotify();
    }
    reparseDefinitions();
  });

  onRequestDefinitions(() => ({
    definitions: state.definitionsInfo ? state.definitionsInfo.raw : undefined,
  }));

  onProcessNode(args => {
    const { nodeId } = args;
    processNodeById(nodeId);
  });

  onProcessNodeIfNecessary(args => {
    const { nodeId } = args;
    processNodeByIdIfNecessary(nodeId);
  });

  onRequestPortData(async args => {
    const { nodeId, port } = args;
    const node = requireNode(nodeId, state.graph!);
    // debug(`got port data request from "${node.id}"`);
    if (!nodeIsCached(node)) {
      await processNode(node);
    }
    return { data: getPortData(node, port, state.graph!) };
  });

  // Sync attribute changes in nodes (i.e. the UI changed a node's state). The
  // editor only sends this event when it only expects Cocoon to persist the
  // changes and nothing else (e.g. changing a node's position). Therefore, the
  // definitions are not parsed again.
  onSyncNode(args => {
    const { serialisedNode } = args;
    const node = requireNode(_.get(serialisedNode, 'id'), state.graph!);
    debug(`syncing node "${node.id}"`);
    _.assign(node, deserialiseNode(serialisedNode));
  });

  onRequestNodeSync(args => {
    const { nodeId, syncId } = args;
    if (state.graph) {
      // Ignore request if there's no graph, since data views will send these
      // requests regardless
      const node = requireNode(nodeId, state.graph);
      if (syncId === undefined || syncId !== node.syncId) {
        syncNode(node);
      }
    }
  });

  // If the node view state changes (due to interacting with the data view
  // window of a node), re-processes the node
  onChangeNodeViewState(args => {
    const { nodeId, viewState } = args;
    const node = requireNode(nodeId, state.graph!);
    if (viewStateHasChanged(node, viewState)) {
      updateViewState(node, viewState);
      debug(`view state changed for "${node.id}"`);
      processNode(node);

      // Write changes back to definitions
      updateDefinitionsAndNotify();
    }
  });

  onQueryNodeView(args => {
    const { nodeId, query } = args;
    const node = requireNode(nodeId, state.graph!);
    const context = createNodeContextFromState(node);
    return respondToViewQuery(node, state.registry!, context, query);
  });

  onQueryNodeViewData(args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, state.graph!);
    return { viewData: node.state.viewData };
  });

  onCreateNode(async args => {
    const { type, gridPosition, edge } = args;
    debug(`creating new node of type "${type}"`);
    const nodeId = createUniqueNodeId(state.graph!, type);
    const nodeDefinition = createNodeDefinition(
      state.definitionsInfo!.parsed!,
      type,
      nodeId,
      gridPosition
    );
    if (edge !== undefined) {
      if (edge.fromNodeId === undefined) {
        // Create outgoing edge
        assignPortDefinition(
          requireNode(edge.toNodeId!, state.graph!).definition,
          edge.toNodePort,
          nodeId,
          edge.fromNodePort
        );
      } else {
        // Create incoming edge
        assignPortDefinition(
          nodeDefinition,
          edge.toNodePort,
          edge.fromNodeId,
          edge.fromNodePort
        );
      }
    }
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onRemoveNode(async args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, state.graph!);
    if (node.edgesOut.length === 0) {
      debug(`removing node "${nodeId}"`);
      removeNodeDefinition(state.definitionsInfo!.parsed!, nodeId);
      await updateDefinitionsAndNotify();
      await reparseDefinitions();
    } else {
      debug(`can't remove node "${nodeId}" because it has outgoing edges`);
    }
  });

  onCreateEdge(async args => {
    const { fromNodeId, fromNodePort, toNodeId, toNodePort } = args;
    debug(
      `creating new edge "${fromNodeId}/${fromNodePort} -> ${toNodeId}/${toNodePort}"`
    );
    const toNode = requireNode(toNodeId, state.graph!);
    assignPortDefinition(
      toNode.definition,
      toNodePort,
      fromNodeId,
      fromNodePort
    );
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
    invalidateNodeCacheDownstream(toNode);
  });

  onRemoveEdge(async args => {
    const { nodeId, port } = args;
    const node = requireNode(nodeId, state.graph!);
    invalidateNodeCacheDownstream(node);
    if (port.incoming) {
      debug(`removing edge to "${nodeId}/${port}"`);
      removePortDefinition(node.definition, port.name);
    } else {
      // TODO: remove all connected edges
    }
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onClearPersistedCache(async args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, state.graph!);
    clearPersistedCache(node, state.definitionsInfo!);
  });

  onCreateView(async args => {
    const { nodeId, type, port } = args;
    debug(`creating new view of type "${type}"`);
    const node = requireNode(nodeId, state.graph!);
    invalidateViewCache(node);
    assignViewDefinition(node.definition, type, port);
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
    await processNodeById(args.nodeId);
  });

  onRemoveView(async args => {
    const { nodeId } = args;
    debug(`removing view for "${nodeId}"`);
    const node = requireNode(nodeId, state.graph!);
    invalidateViewCache(node);
    removeViewDefinition(node.definition);
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onRequestMemoryUsage(() => ({
    memoryUsage: process.memoryUsage(),
    process: ProcessName.Cocoon,
  }));

  onRunProcess(args => {
    runProcess(args.command, {
      args: args.args,
      cwd: state.definitionsInfo!.root,
    });
  });

  onPurgeCache(() => {
    state
      .graph!.nodes.filter(node => nodeIsCached(node))
      .forEach(node => invalidateNodeCache(node));
  });

  onSendToNode(args => {
    const { nodeId } = args;
    const node = requireNode(nodeId, state.graph!);
    const cocoonNode = requireCocoonNode(state.registry!, node.definition.type);
    if (!cocoonNode.receive) {
      throw new Error(`node "${nodeId}" received data but has no receive()`);
    }
    const context = createNodeContextFromState(node);
    context.debug(`receiving data`);
    cocoonNode.receive(context, args.data);
  });

  onShiftPositions(async args => {
    const eligibleNodes = state.graph!.nodes.filter(
      node => !_.isNil(node.definition.editor)
    );
    if (args.beforeColumn) {
      eligibleNodes
        .filter(node => !_.isNil(node.definition.editor!.col))
        .filter(node => node.definition.editor!.col! >= args.beforeColumn!)
        .forEach(node => {
          node.definition.editor!.col! += args.shiftBy;
        });
    }
    if (args.beforeRow) {
      eligibleNodes
        .filter(node => !_.isNil(node.definition.editor!.row))
        .filter(node => node.definition.editor!.row! >= args.beforeRow!)
        .forEach(node => {
          node.definition.editor!.col! += args.shiftBy;
        });
    }
    await updateDefinitionsAndNotify();
    await reparseDefinitions();
  });

  onOpenFile(args => {
    open(args.uri);
  });

  onRequestRegistry(() => ({ registry: state.registry! }));

  // Respond to IPC messages
  process.on('message', m => {
    if (m === 'close') {
      process.exit(0);
    }
  });

  // Emit ready signal
  if (process.send) {
    process.send('ready');
  }

  // Catch all errors
  process
    .on('unhandledRejection', error => {
      if (error) {
        sendError({ error: serializeError(error) });
        throw error;
      }
      throw new Error('unhandled rejection');
    })
    .on('uncaughtException', error => {
      console.error(error.message, error);
      sendError({ error: serializeError(error) });
    });
}

async function createNodeProcessor(node: GraphNode) {
  if (cacheRestoration.get(node.id)) {
    // This node became part of an execution plan before it had the chance to
    // restore its persisted cache. Our best course of action is to wait for the
    // cache to be restored and skip the processing step, since that's the most
    // likely correct behaviour.
    await cacheRestoration.get(node.id);
    return;
  }

  // debug(`evaluating node "${node.id}"`);
  let maybeContext: CocoonNodeContext | null = null;

  try {
    const cocoonNode = requireCocoonNode(state.registry!, node.definition.type);
    node.cocoonNode = cocoonNode;
    invalidateNodeCache(node, false);

    // Update status
    node.state.status = NodeStatus.processing;
    syncNode(node);

    // Create node context
    const context = createNodeContextFromState(node);
    maybeContext = context;

    // Process node
    context.debug(`processing`);
    const result = await cocoonNode.process(context);
    if (result !== undefined) {
      node.state.summary = result;
    } else {
      delete node.state.summary;
    }

    // Update port stats
    updatePortStats(node);

    // Update view
    await updateView(node, state.registry!, context);

    // Persist cache
    if (persistIsEnabled(node)) {
      try {
        await writePersistedCache(node, state.definitionsInfo!);
      } catch (error) {
        context.debug(`failed to write persisted cache`);
        context.debug(error);
      }
    }

    // Update status and sync node
    node.state.status = NodeStatus.processed;
    syncNode(node);
  } catch (error) {
    maybeContext ? maybeContext.debug(error) : debug(error);
    node.state.error = error;
    node.state.status = NodeStatus.error;
    syncNode(node);
  }
}

function invalidateNodeCacheDownstream(node: GraphNode, sync = true) {
  const downstreamNodes = resolveDownstream(node, state.graph!);
  downstreamNodes.forEach(n => {
    invalidateNodeCache(n, sync);
  });
  return downstreamNodes;
}

function invalidateNodeCache(node: GraphNode, sync = true) {
  if (nodeHasState(node)) {
    node.state = {};
    if (sync) {
      debug(`invalidating "${node.id}"`);
      syncNode(node);
    }
  }
}

function invalidateViewCache(node: GraphNode, sync = true) {
  node.state.viewData = null;
  delete node.state.viewDataId;
  if (sync) {
    debug(`invalidating view for "${node.id}"`);
    syncNode(node);
  }
}

async function parseDefinitions(definitionsPath: string) {
  // Change back to original CWD to resolve relative paths correctly
  process.chdir(state.originalCwd);

  // Resolve and read definitions
  const resolvedDefinitionsPath = resolvePath(definitionsPath);
  let definitionsRaw: string;
  try {
    definitionsRaw = await readFile(resolvedDefinitionsPath);
  } catch (error) {
    error.message = `failed to read Cocoon definitions at "${definitionsPath}": ${error.message}`;
    throw error;
  }

  // If we already have definitions (and the path didn't change) we can attempt
  // to keep some of the cache alive
  const sameDefinitionsFile =
    state.definitionsInfo &&
    state.definitionsInfo.path === resolvedDefinitionsPath;

  // Already save some info prior to parsing, since it might fail
  state.definitionsInfo = {
    path: resolvedDefinitionsPath,
    raw: definitionsRaw,
    root: path.dirname(resolvedDefinitionsPath),
  };

  // Change CWD to the definitions path, to resolve module imports and relative
  // paths in the definition correctly
  process.chdir(state.definitionsInfo.root);

  // Parse definitions
  debug(`parsing Cocoon definitions file at "${resolvedDefinitionsPath}"`);
  const nextDefinitions: CocoonDefinitions = parseCocoonDefinitions(
    definitionsRaw
  ) || { nodes: {} };
  state.definitionsInfo.parsed = nextDefinitions;

  // Create/update the node registry if necessary
  if (!state.registry || !sameDefinitionsFile) {
    state.registry = await createAndInitialiseRegistry(state.definitionsInfo);
  }

  // Create graph & transfer state from the previous graph
  const prevGraph = state.graph;
  const nextGraph = createGraphFromDefinitions(
    state.definitionsInfo.parsed,
    state.registry!
  );
  if (sameDefinitionsFile && state.previousDefinitionsInfo && prevGraph) {
    const diff = diffDefinitions(
      state.previousDefinitionsInfo.parsed!,
      nextDefinitions
    );

    // Invalidate node cache of changed nodes
    const invalidatedNodeIds = new Set<string>();
    diff.changedNodes.forEach(nodeId => {
      const changedNode = requireNode(nodeId, prevGraph);
      invalidateNodeCacheDownstream(changedNode, false).forEach(node => {
        invalidatedNodeIds.add(node.id);
      });
    });

    // Invalidate node cache in the new graph, since newly connected nodes are
    // no longer valid as well
    diff.changedNodes.forEach(nodeId => {
      const changedNode = nextGraph.map.get(nodeId);
      if (changedNode) {
        invalidateNodeCacheDownstream(changedNode, false).forEach(node => {
          invalidatedNodeIds.add(node.id);
        });
      }
    });

    // Transfer state
    transferGraphState(prevGraph, nextGraph);

    // Determine if the graph layout needs an update
    const updateLayout = true;
    // This feature is very error prone and might not be worth using at all.
    // Known problems:
    // - doesn't update layout when changing port assignments (edges)
    // - doesn't update when inserting rows/columns
    //
    // const updateLayout =
    //   diff.addedNodes.length > 0 ||
    //   diff.removedNodes.length > 0 ||
    //   diff.changedNodes.reduce((change: boolean, nodeId) => {
    //     const prevNode = prevGraph.map.get(nodeId);
    //     const newNode = nextGraph.map.get(nodeId);
    //     if (prevNode && newNode) {
    //       return (
    //         change || !positionIsEqual(prevNode.definition, newNode.definition)
    //       );
    //     }
    //     return true;
    //   }, false);

    // Sync graph/nodes
    if (updateLayout) {
      debug('graph changed, syncing');
      sendSyncGraph({
        registry: state.registry!,
        serialisedGraph: serialiseGraph(nextGraph),
      });
    } else {
      // Sync nodes that either
      // - had changes in their definition
      // - had changes in their edges
      nextGraph.nodes
        .map(n => ({
          next: n,
          prev: requireNode(n.id, prevGraph),
        }))
        .filter(
          x =>
            invalidatedNodeIds.has(x.next.id) ||
            !edgesAreEqual(x.next.edgesIn, x.prev.edgesIn) ||
            !edgesAreEqual(x.next.edgesOut, x.prev.edgesOut)
        )
        .forEach(x => {
          debug(`detected changes in node "${x.next.id}"`);
          sendSyncNode({ serialisedNode: serialiseNode(x.next) });
        });
    }

    // Update graph layout (if any node position has changed the entire rest of
    // the layout needs to be re-evaluated)
  } else {
    // Restore persisted cache
    nextGraph.nodes.forEach(async node => {
      if (
        !nodeIsCached(node) &&
        nodeHasPersistedCache(node, state.definitionsInfo!)
      ) {
        const restore = restorePersistedCache(node, state.definitionsInfo!);
        cacheRestoration.set(node.id, restore);
        await restore;
        debug(`restored persisted cache for "${node.id}"`);
        node.state.summary = `Restored persisted cache`;
        node.state.status = NodeStatus.processed;
        updatePortStats(node);
        syncNode(node);
        cacheRestoration.delete(node.id);
        await updateView(
          node,
          state.registry!,
          createNodeContextFromState(node)
        );
      }
    });

    // Sync graph (loading the persisted cache can take a long time, so we sync
    // the graph already and update the nodes that were restored individually)
    sendSyncGraph({
      registry: state.registry!,
      serialisedGraph: serialiseGraph(nextGraph),
    });
  }

  // Reset errors
  sendError({ error: null });

  // Commit graph and process hot nodes
  state.graph = nextGraph;
  state.previousDefinitionsInfo = _.cloneDeep(state.definitionsInfo);
  processHotNodes();

  return state.definitionsInfo;
}

async function reparseDefinitions() {
  return parseDefinitions(state.definitionsInfo!.path);
}

function unwatchDefinitionsFile() {
  const definitionsPath = state.definitionsInfo
    ? state.definitionsInfo.path
    : null;
  if (definitionsPath) {
    if (watchedFiles.has(definitionsPath)) {
      // debug(`removing watch for "${path}"`);
      watchedFiles.delete(definitionsPath);
      fs.unwatchFile(definitionsPath);
    }
  }
}

function watchDefinitionsFile() {
  const definitionsPath = state.definitionsInfo!.path;
  if (!watchedFiles.has(definitionsPath)) {
    // debug(`watching "${path}"`);
    watchedFiles.add(definitionsPath);
    fs.watchFile(definitionsPath, { interval: 500 }, async () => {
      debug(`definitions file at "${definitionsPath}" was modified`);
      await reparseDefinitions();
      // Make sure the client gets the definitions contents as well
      sendUpdateDefinitions({ definitions: state.definitionsInfo!.raw });
    });
  }
}

async function updateDefinitionsAndNotify() {
  debug(`updating definitions`);
  updateDefinitionsFromGraph(state.graph!, state.definitionsInfo!.parsed!);
  unwatchDefinitionsFile();
  const definitions = await writeYamlFile(
    state.definitionsInfo!.path,
    state.definitionsInfo!.parsed,
    { debug }
  );
  watchDefinitionsFile();

  // Notify the client that the definition changed
  sendUpdateDefinitions({ definitions });

  return definitions;
}

function syncNode(node: GraphNode) {
  node.syncId = Date.now();
  sendSyncNode({ serialisedNode: serialiseNode(node) });
}

/**
 * Extends the default logic for checking if a node needs to be processed by
 * checking against the active cache restoration map.
 *
 * If we didn't do that, the execution planner would add nodes upstream of a
 * node that has a cache restoration running.
 */
function nodeNeedsProcessing(node: GraphNode) {
  return cacheRestoration.get(node.id) ? false : _nodeNeedsProcessing(node);
}
