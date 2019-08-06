import {
  deserialiseNode,
  initialiseIPC,
  logIPC,
  onChangeNodeViewState,
  onClearPersistedCache,
  onCreateEdge,
  onCreateNode,
  onCreateView,
  onDumpPortData,
  onHighlightInViews,
  onOpenCocoonFile,
  onOpenFile,
  onProcessNode,
  onProcessNodeIfNecessary,
  onPurgeCache,
  onQueryNodeView,
  onQueryNodeViewData,
  onReloadRegistry,
  onRemoveEdge,
  onRemoveNode,
  onRemoveView,
  onRequestCocoonFile,
  onRequestMemoryUsage,
  onRequestNodeSync,
  onRequestPortData,
  onRequestRegistry,
  onRunProcess,
  onSendToNode,
  onShiftPositions,
  onStopExecutionPlan,
  onSyncNode,
  onUpdateCocoonFile,
  sendError,
  sendHighlightInViews,
  sendSyncGraph,
  sendSyncNode,
  sendUpdateCocoonFile,
  sendUpdateNodeProgress,
  serialiseGraph,
  serialiseNode,
  setupLogForwarding,
} from '@cocoon/ipc';
import {
  CocoonFile,
  CocoonFileInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
  NodeStatus,
  ProcessName,
  Progress,
} from '@cocoon/types';
import diffCocoonFiles from '@cocoon/util/diffCocoonFiles';
import requireCocoonNode from '@cocoon/util/requireCocoonNode';
import requireGraphNode from '@cocoon/util/requireGraphNode';
import resolveFilePath from '@cocoon/util/resolveFilePath';
import spawnChildProcess from '@cocoon/util/spawnChildProcess';
import Debug from 'debug';
import fs from 'fs';
import yaml from 'js-yaml';
import _ from 'lodash';
import open from 'open';
import path from 'path';
import serializeError from 'serialize-error';
import tempy from 'tempy';
import { createNodeContext } from './context';
import {
  assignPortDefinition,
  assignViewDefinition,
  createNodeDefinition,
  removePortDefinition,
  removeViewDefinition,
} from './definitions';
import {
  createGraphFromCocoonFile,
  createUniqueNodeId,
  edgesAreEqual,
  getPortData,
  nodeHasErrorUpstream,
  nodeHasState,
  nodeIsCached,
  nodeNeedsProcessing as _nodeNeedsProcessing,
  resolveDownstream,
  transferGraphState,
  updateCocoonFileFromGraph,
  updatePortStats,
  updateViewState,
  viewStateHasChanged,
} from './graph';
import {
  clearPersistedCache,
  persistIsEnabled,
  respondToViewQuery,
  restorePersistedCache,
  updateView,
  writePersistedCache,
} from './nodes';
import {
  appendToExecutionPlan,
  cancelActiveExecutionPlan,
  createAndExecutePlanForNodes,
  ExecutionPlannerState,
  initialiseExecutionPlanner,
} from './planner';
import { createAndInitialiseRegistry } from './registry';

interface State {
  cocoonFileInfo: CocoonFileInfo | null;
  graph: Graph | null;
  originalCwd: string;
  planner: ExecutionPlannerState;
  previousFileInfo: CocoonFileInfo | null;
  registry: CocoonRegistry | null;
}

const debug = Debug('cocoon:index');

const watchedFiles = new Set();
const cacheRestoration: Map<string, Promise<any>> = new Map();
const state: State = {
  cocoonFileInfo: null,
  graph: null,
  originalCwd: process.cwd(),
  planner: initialiseExecutionPlanner(),
  previousFileInfo: null,
  registry: null,
};

export function openCocoonFile(filePath: string) {
  return parseCocoonFile(resolveFilePath(filePath));
}

export function processNodeById(nodeId: string) {
  const node = requireGraphNode(nodeId, state.graph!);
  return processNode(node);
}

export function processNodeByIdIfNecessary(nodeId: string) {
  const node = requireGraphNode(nodeId, state.graph!);
  return processNodeIfNecessary(node);
}

export async function processNode(node: GraphNode) {
  // Clear the node cache before creating an execution plan -- otherwise
  // nothing will happen if the node is already cached
  invalidateNodeCacheDownstream(node);
  await createAndExecutePlanForNodes(
    state.planner,
    node,
    createNodeProcessor,
    state.graph!,
    {
      afterPlanning: () => {
        // Append unprocessed hot nodes to plan
        state
          .graph!.nodes.filter(
            n => n.hot === true && n.state.status === undefined
          )
          .forEach(n => appendToExecutionPlan(state.planner, n));
      },
      nodeAdded: markNodeAsScheduled,
      nodeNeedsProcessing,
      nodeRemoved: markNodeAsNotScheduled,
    }
  );
  return state.graph!;
}

export async function processNodeIfNecessary(node: GraphNode) {
  // Additionally to not being processed yet, we require all upstream nodes to
  // be error free. Only explicit processing requests will force error states to
  // be re-evaluated.
  if (nodeNeedsProcessing(node) && !nodeHasErrorUpstream(node, state.graph!)) {
    invalidateNodeCacheDownstream(node);
    await createAndExecutePlanForNodes(
      state.planner,
      node,
      createNodeProcessor,
      state.graph!,
      {
        nodeAdded: markNodeAsScheduled,
        nodeNeedsProcessing,
        nodeRemoved: markNodeAsNotScheduled,
      }
    );
  }
  return state.graph!;
}

export async function processAllNodes() {
  const nodes = state.graph!.nodes;
  nodes.forEach(x => invalidateNodeCache(x));
  await createAndExecutePlanForNodes(
    state.planner,
    nodes,
    createNodeProcessor,
    state.graph!,
    {
      nodeAdded: markNodeAsScheduled,
      nodeNeedsProcessing,
      nodeRemoved: markNodeAsNotScheduled,
    }
  );
  return state.graph!;
}

export async function processHotNodes() {
  const unprocessedHotNodes = state.graph!.nodes.filter(
    n => n.hot === true && n.state.status === undefined
  );
  await createAndExecutePlanForNodes(
    state.planner,
    unprocessedHotNodes,
    createNodeProcessor,
    state.graph!,
    {
      nodeAdded: markNodeAsScheduled,
      nodeNeedsProcessing,
      nodeRemoved: markNodeAsNotScheduled,
    }
  );
  return state.graph!;
}

export function createNodeContextFromState(node: GraphNode) {
  return createNodeContext(
    state.cocoonFileInfo!,
    state.registry!,
    state.graph!,
    node,
    () => invalidateNodeCacheDownstream(node)
  );
}

export async function testDefinition(definitionPath: string, nodeId?: string) {
  await initialise();
  await openCocoonFile(definitionPath);
  const graph = await (nodeId ? processNodeById(nodeId) : processAllNodes());
  return graph.nodes.reduce((all, node) => {
    all[node.id] = node.state;
    return all;
  }, {});
}

export async function initialise() {
  // Run IPC server and register IPC events
  logIPC(Debug('cocoon:ipc'));
  await initialiseIPC(ProcessName.Cocoon);
  setupLogForwarding(Debug);

  onOpenCocoonFile(async args => {
    debug(`opening Cocoon file at "${args.cocoonFilePath}"`);
    unwatchCocoonFile();

    // Reset state to force a complete graph re-construction
    state.cocoonFileInfo = null;
    state.graph = null;
    state.registry = null;

    try {
      await openCocoonFile(args.cocoonFilePath);
    } catch (error) {
      throw error;
    } finally {
      if (state.cocoonFileInfo) {
        // If we at least got the raw Cocoon file (i.e. reading the file was
        // successful), send the contents to the client
        sendUpdateCocoonFile({ contents: state.cocoonFileInfo!.raw });
        watchCocoonFile();
      }
    }
  });

  onUpdateCocoonFile(async args => {
    if (args.contents) {
      // The client updated the Cocoon file manually (via the text editor) --
      // persist the changes and re-build the graph
      unwatchCocoonFile();
      await fs.promises.writeFile(state.cocoonFileInfo!.path, args.contents);
      watchCocoonFile();
    } else {
      await updateCocoonFileAndNotify();
    }
    reparseCocoonFile();
  });

  onRequestCocoonFile(() => ({
    contents: state.cocoonFileInfo ? state.cocoonFileInfo.raw : undefined,
  }));

  onProcessNode(args => {
    const { nodeId } = args;
    processNodeById(nodeId);
  });

  onProcessNodeIfNecessary(args => {
    const { nodeId } = args;
    processNodeByIdIfNecessary(nodeId);
  });

  onStopExecutionPlan(() => {
    cancelActiveExecutionPlan(state.planner);
  });

  onRequestPortData(async args => {
    debug(`requesting port data for "${args.nodeId}/${args.port.name}"`);
    const { nodeId, port } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    // debug(`got port data request from "${node.id}"`);
    if (!nodeIsCached(node)) {
      await processNode(node);
    }
    const data = getPortData(node, port, state.graph!);
    return {
      data:
        args.sampleSize && _.isArray(data)
          ? args.sampleSize > 1
            ? _.sampleSize(data, args.sampleSize)
            : _.sample(data)
          : data,
    };
  });

  onDumpPortData(async args => {
    const tempPath = tempy.file({ extension: '.json' });
    // TODO: create @cocoon/util/stringifyPort
    // TODO: create @cocoon/util/parsePortString
    debug(
      `dumping port data for "${args.nodeId}/${args.port.name}" into "${tempPath}"`
    );
    const { nodeId, port } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    if (!nodeIsCached(node)) {
      await processNode(node);
    }
    const data = getPortData(node, port, state.graph!);
    await fs.promises.writeFile(tempPath, JSON.stringify(data, undefined, 2));
    open(tempPath);
  });

  // Sync attribute changes in nodes (i.e. the UI changed a node's state). The
  // editor only sends this event when it only expects Cocoon to persist the
  // changes and nothing else (e.g. changing a node's position).
  onSyncNode(args => {
    const { serialisedNode } = args;
    const node = requireGraphNode(_.get(serialisedNode, 'id'), state.graph!);
    debug(`syncing node "${node.id}"`);
    _.assign(node, deserialiseNode(serialisedNode));
  });

  onRequestNodeSync(args => {
    const { nodeId, syncId } = args;
    if (state.graph) {
      // Ignore request if there's no graph, since data views will send these
      // requests regardless
      const node = requireGraphNode(nodeId, state.graph);
      if (syncId === undefined || syncId !== node.syncId) {
        syncNode(node);
      }
    }
  });

  onCreateView(async args => {
    const { nodeId, type, port } = args;
    debug(`creating new view of type "${type}"`);
    const node = requireGraphNode(nodeId, state.graph!);
    invalidateViewCache(node);
    assignViewDefinition(node.definition, type, port);
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
    await processNodeById(args.nodeId);
  });

  onRemoveView(async args => {
    const { nodeId } = args;
    debug(`removing view for "${nodeId}"`);
    const node = requireGraphNode(nodeId, state.graph!);
    invalidateViewCache(node);
    removeViewDefinition(node.definition);
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
  });

  // If the node view state changes (due to interacting with the data view
  // window of a node), re-processes the node
  onChangeNodeViewState(args => {
    const { nodeId, viewState } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    if (viewStateHasChanged(node, viewState)) {
      updateViewState(node, viewState);
      debug(`view state changed for "${node.id}"`);
      processNode(node);

      // Write changes back to Cocoon file
      updateCocoonFileAndNotify();
    }
  });

  onQueryNodeView(args => {
    const { nodeId, query } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    const context = createNodeContextFromState(node);
    return respondToViewQuery(node, state.registry!, context, query);
  });

  onQueryNodeViewData(args => {
    const { nodeId } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    return { viewData: node.state.viewData };
  });

  onHighlightInViews(args => {
    if (args.data) {
      debug(`broadcasting highlighting data`, args);
    }
    sendHighlightInViews(args);
  });

  onCreateNode(async args => {
    const { type, gridPosition, edge } = args;
    debug(`creating new node of type "${type}"`);
    const nodeId = createUniqueNodeId(state.graph!, type);
    const nodeDefinition = createNodeDefinition(
      state.cocoonFileInfo!.parsed!,
      type,
      nodeId,
      gridPosition
    );
    if (edge !== undefined) {
      if (edge.fromNodeId === undefined) {
        // Create outgoing edge
        assignPortDefinition(
          requireGraphNode(edge.toNodeId!, state.graph!).definition,
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
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
  });

  onRemoveNode(async args => {
    const { nodeId } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    if (node.edgesOut.length === 0) {
      debug(`removing node "${nodeId}"`);
      delete state.cocoonFileInfo!.parsed!.nodes[nodeId];
      await updateCocoonFileAndNotify();
      await reparseCocoonFile();
    } else {
      debug(`can't remove node "${nodeId}" because it has outgoing edges`);
    }
  });

  onCreateEdge(async args => {
    const { fromNodeId, fromNodePort, toNodeId, toNodePort } = args;
    debug(
      `creating new edge "${fromNodeId}/${fromNodePort} -> ${toNodeId}/${toNodePort}"`
    );
    const toNode = requireGraphNode(toNodeId, state.graph!);
    assignPortDefinition(
      toNode.definition,
      toNodePort,
      fromNodeId,
      fromNodePort
    );
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
    invalidateNodeCacheDownstream(toNode);
  });

  onRemoveEdge(async args => {
    const { nodeId, port } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    invalidateNodeCacheDownstream(node);
    if (port.incoming) {
      debug(`removing edge to "${nodeId}/${port}"`);
      removePortDefinition(node.definition, port.name);
    } else {
      // TODO: remove all connected edges
    }
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
  });

  onClearPersistedCache(async args => {
    const { nodeId } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    clearPersistedCache(node, state.cocoonFileInfo!);
  });

  onRequestMemoryUsage(() => ({
    memoryUsage: process.memoryUsage(),
    process: ProcessName.Cocoon,
  }));

  onRunProcess(args => {
    spawnChildProcess(args.command, {
      args: args.args,
      cwd: state.cocoonFileInfo!.root,
      debug,
    });
  });

  onPurgeCache(() => {
    state
      .graph!.nodes.filter(node => nodeIsCached(node))
      .forEach(node => invalidateNodeCache(node));
  });

  onSendToNode(args => {
    const { nodeId } = args;
    const node = requireGraphNode(nodeId, state.graph!);
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
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
  });

  onOpenFile(args => {
    open(args.uri);
  });

  onRequestRegistry(() => ({ registry: state.registry! }));

  onReloadRegistry(() => {
    delete state.registry;
    reparseCocoonFile();
  });

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
    delete node.state.summary;
    syncNode(node);

    // Create node context
    const context = createNodeContextFromState(node);
    maybeContext = context;

    // Process node
    context.debug(`processing`);
    const processor = cocoonNode.process(context);
    const throttledProgress = _.throttle((progress: Progress) => {
      setNodeProgress(node, progress);
    }, 200);
    while (true) {
      if (!processor.next) {
        debug(`warning: node "${node.id}" did not return a generator`);
        setNodeProgress(node, await (processor as any)());
      }
      // setImmediate lets NodeJS process I/O events, so that we don't end up
      // blocking the UI when processing nodes with long execution times
      const progress = await await new Promise<
        Promise<IteratorResult<Progress>>
      >(resolve => {
        setImmediate(() => {
          resolve(processor.next());
        });
      });
      if (!state.planner.activePlan || state.planner.activePlan.canceled) {
        // If the plan got canceled, throw away all results and stop
        invalidateNodeCache(node);
        return;
      } else if (progress.done) {
        throttledProgress.cancel();
        setNodeProgress(node, progress.value, false);
        break;
      } else {
        throttledProgress(progress.value);
      }
    }

    // Update port stats
    updatePortStats(node);

    // Update view
    await updateView(node, state.registry!, context);

    // Persist cache
    if (persistIsEnabled(node)) {
      try {
        await writePersistedCache(node, state.cocoonFileInfo!);
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

function markNodeAsScheduled(node: GraphNode, sync = true) {
  node.state.scheduled = true;
  sendSyncNode({ serialisedNode: serialiseNode(node) });
}

function markNodeAsNotScheduled(node: GraphNode, sync = true) {
  node.state.scheduled = false;
  sendSyncNode({ serialisedNode: serialiseNode(node) });
}

function setNodeProgress(node: GraphNode, progress: Progress, sync = true) {
  if (progress && node.state.status === NodeStatus.processing) {
    let summary: string | null = null;
    let percent: number | null = null;
    if (_.isString(progress)) {
      summary = progress;
    } else if (_.isNumber(progress)) {
      percent = progress;
      summary = `${Math.round(percent * 100)}%`;
    } else {
      [summary, percent] = progress;
    }
    node.state.summary = summary;
    if (sync) {
      sendUpdateNodeProgress(node.id, { summary, percent });
    }
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

async function parseCocoonFile(filePath: string) {
  // We're going to build a new graph, so all current processing needs to be
  // stopped
  cancelActiveExecutionPlan(state.planner);

  // Change back to original CWD to resolve relative paths correctly
  process.chdir(state.originalCwd);

  // Read Cocoon file
  let rawCocoonFile: string;
  try {
    rawCocoonFile = await fs.promises.readFile(filePath, { encoding: 'utf8' });
  } catch (error) {
    error.message = `failed to read Cocoon file at "${filePath}": ${error.message}`;
    throw error;
  }

  // If we already have a Cocoon file (and the path didn't change) we can
  // attempt to keep some of the cache alive
  const sameCocoonFile =
    state.cocoonFileInfo && state.cocoonFileInfo.path === filePath;

  // Already save some info prior to parsing, since it might fail
  state.cocoonFileInfo = {
    path: filePath,
    raw: rawCocoonFile,
    root: path.dirname(filePath),
  };

  // Change CWD to the Cocoon file path, to resolve module imports and relative
  // paths in the definition correctly
  process.chdir(state.cocoonFileInfo.root);

  // Parse Cocoon file
  debug(`parsing Cocoon file at "${filePath}"`);
  const nextCocoonFile: CocoonFile = yaml.load(rawCocoonFile) || {
    nodes: {},
  };
  state.cocoonFileInfo.parsed = nextCocoonFile;

  // Create/update the node registry if necessary
  if (!state.registry || !sameCocoonFile) {
    state.registry = await createAndInitialiseRegistry(
      state.cocoonFileInfo.root
    );
  }

  // Create graph & transfer state from the previous graph
  const prevGraph = state.graph;
  const nextGraph = createGraphFromCocoonFile(
    state.cocoonFileInfo.parsed,
    state.registry!
  );
  if (sameCocoonFile && state.previousFileInfo && prevGraph) {
    const diff = diffCocoonFiles(
      state.previousFileInfo.parsed!,
      nextCocoonFile,
      _.isEqual
    );

    // Invalidate node cache of changed nodes
    const invalidatedNodeIds = new Set<string>();
    diff.changedNodes.forEach(nodeId => {
      const changedNode = requireGraphNode(nodeId, prevGraph);
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
          prev: requireGraphNode(n.id, prevGraph),
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
    nextGraph.nodes
      .filter(node => persistIsEnabled(node) && !nodeIsCached(node))
      .map(node => ({
        node,
        restore: restorePersistedCache(node, state.cocoonFileInfo!),
      }))
      .filter(({ restore }) => Boolean(restore))
      .forEach(async ({ node, restore }) => {
        cacheRestoration.set(node.id, restore);
        node.state.summary = `Restoring..`;
        node.state.status = NodeStatus.restoring;
        syncNode(node);
        const restoreResult = await restore;
        if (!restoreResult) {
          debug(`failed to restore persisted cache for "${node.id}"`);
          delete node.state.status;
          node.state.summary = `No persisted cache`;
          syncNode(node);
        } else {
          debug(`restored persisted cache for "${node.id}"`);
          node.state.summary = `Restored persisted cache`;
          node.state.status = NodeStatus.processed;
          updatePortStats(node);
          syncNode(node);
        }
        cacheRestoration.delete(node.id);
        await updateView(
          node,
          state.registry!,
          createNodeContextFromState(node)
        );
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
  state.previousFileInfo = _.cloneDeep(state.cocoonFileInfo);
  processHotNodes();

  return state.cocoonFileInfo;
}

async function reparseCocoonFile() {
  return parseCocoonFile(state.cocoonFileInfo!.path);
}

function unwatchCocoonFile() {
  const filePath = state.cocoonFileInfo ? state.cocoonFileInfo.path : null;
  if (filePath) {
    if (watchedFiles.has(filePath)) {
      // debug(`removing watch for "${path}"`);
      watchedFiles.delete(filePath);
      fs.unwatchFile(filePath);
    }
  }
}

function watchCocoonFile() {
  const filePath = state.cocoonFileInfo!.path;
  if (!watchedFiles.has(filePath)) {
    // debug(`watching "${path}"`);
    watchedFiles.add(filePath);
    fs.watchFile(filePath, { interval: 500 }, async () => {
      debug(`Cocoon file at "${filePath}" was modified`);
      await reparseCocoonFile();
      // Make sure the client gets the Cocoon file contents as well
      sendUpdateCocoonFile({ contents: state.cocoonFileInfo!.raw });
    });
  }
}

async function updateCocoonFileAndNotify() {
  debug(`updating Cocoon file`);
  updateCocoonFileFromGraph(state.graph!, state.cocoonFileInfo!.parsed!);
  unwatchCocoonFile();
  const contents = yaml.dump(state.cocoonFileInfo!.parsed, {
    sortKeys: true,
  });
  await fs.promises.writeFile(state.cocoonFileInfo!.path, contents);
  debug(`updated Cocoon file at "${state.cocoonFileInfo!.path}"`);
  watchCocoonFile();

  // Notify the client that the definition changed
  sendUpdateCocoonFile({ contents });

  return contents;
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
