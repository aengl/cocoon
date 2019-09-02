import {
  CocoonFile,
  CocoonFileInfo,
  CocoonNodeContext,
  CocoonRegistry,
  Graph,
  GraphNode,
  IPCServer,
  NodeStatus,
  Progress,
} from '@cocoon/types';
import diffCocoonFiles from '@cocoon/util/diffCocoonFiles';
import { onChangeNodeViewState } from '@cocoon/util/ipc/changeNodeViewState';
import { onClearPersistedCache } from '@cocoon/util/ipc/clearPersistedCache';
import { onCreateEdge } from '@cocoon/util/ipc/createEdge';
import { onCreateNode } from '@cocoon/util/ipc/createNode';
import createServer from '@cocoon/util/ipc/createServer';
import { onCreateView } from '@cocoon/util/ipc/createView';
import { onDumpPortData } from '@cocoon/util/ipc/dumpPortData';
import { emitError } from '@cocoon/util/ipc/error';
import {
  emitHighlightInViews,
  onHighlightInViews,
} from '@cocoon/util/ipc/highlightInViews';
import { onInvalidateNodeCache } from '@cocoon/util/ipc/invalidateNodeCache';
import { emitLog } from '@cocoon/util/ipc/log';
import { onOpenCocoonFile } from '@cocoon/util/ipc/openCocoonFile';
import { onOpenFile } from '@cocoon/util/ipc/openFile';
import { onProcessNode } from '@cocoon/util/ipc/processNode';
import { onProcessNodeIfNecessary } from '@cocoon/util/ipc/processNodeIfNecessary';
import { onPurgeCache } from '@cocoon/util/ipc/purgeCache';
import { onReloadRegistry } from '@cocoon/util/ipc/reloadRegistry';
import { onRemoveEdge } from '@cocoon/util/ipc/removeEdge';
import { onRemoveNode } from '@cocoon/util/ipc/removeNode';
import { onRemoveView } from '@cocoon/util/ipc/removeView';
import { onRequestCocoonFile } from '@cocoon/util/ipc/requestCocoonFile';
import { onRequestMemoryUsage } from '@cocoon/util/ipc/requestMemoryUsage';
import { onRequestNodeSync } from '@cocoon/util/ipc/requestNodeSync';
import { onRequestNodeView } from '@cocoon/util/ipc/requestNodeView';
import { onRequestNodeViewData } from '@cocoon/util/ipc/requestNodeViewData';
import { onRequestPortData } from '@cocoon/util/ipc/requestPortData';
import { onRequestRegistry } from '@cocoon/util/ipc/requestRegistry';
import { onRunProcess } from '@cocoon/util/ipc/runProcess';
import { onSendToNode } from '@cocoon/util/ipc/sendToNode';
import setupLogForwarding from '@cocoon/util/ipc/setupLogForwarding';
import { onShiftPositions } from '@cocoon/util/ipc/shiftPositions';
import { onStopExecutionPlan } from '@cocoon/util/ipc/stopExecutionPlan';
import { emitSyncGraph } from '@cocoon/util/ipc/syncGraph';
import { emitSyncNode, onSyncNode } from '@cocoon/util/ipc/syncNode';
import {
  emitUpdateCocoonFile,
  onUpdateCocoonFile,
} from '@cocoon/util/ipc/updateCocoonFile';
import { emitUpdateNodeProgress } from '@cocoon/util/ipc/updateNodeProgress';
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
import WebSocket from 'ws';
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
  nodeNeedsProcessing,
  resolveDownstream,
  transferGraphState,
  updateCocoonFileFromGraph,
  updatePortStats,
  updateViewState,
  viewStateHasChanged,
} from './graph';
import { deserialiseNode, serialiseGraph, serialiseNode } from './ipc';
import {
  clearPersistedCache,
  persistIsEnabled,
  respondToViewQuery,
  restorePersistedCache,
  updateView,
  writePersistedCache,
  writeToPorts,
} from './nodes/index';
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
  previousPlannerError: Error | null;
  registry: CocoonRegistry | null;
  server: IPCServer | null;
}

const debug = Debug('cocoon:index');

const watchedFiles = new Set();
const state: State = {
  cocoonFileInfo: null,
  graph: null,
  originalCwd: process.cwd(),
  planner: initialiseExecutionPlanner(),
  previousFileInfo: null,
  previousPlannerError: null,
  registry: null,
  server: null,
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
  await scheduleNodeProcessing(node);
  return state.graph!;
}

export async function processNodeIfNecessary(node: GraphNode) {
  if (
    nodeNeedsProcessing(node) &&
    // Prevent infinite loops by requiring the previous plan to have executed
    // error-free
    !state.previousPlannerError &&
    // Require all upstream nodes to be error free. Only explicit processing
    // requests will force error states to be re-evaluated.xxx
    !nodeHasErrorUpstream(node, state.graph!)
  ) {
    invalidateNodeCacheDownstream(node);
    await scheduleNodeProcessing(node);
  }
  return state.graph!;
}

export async function processAllNodes() {
  const nodes = state.graph!.nodes;
  nodes.forEach(x => invalidateNodeCache(x));
  await scheduleNodeProcessing(nodes);
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

export async function testDefinition(
  definitionPath: string,
  {
    nodeId,
    reduceNode = node => ({
      status: node.state.status,
      summary: node.state.summary,
    }),
  }: {
    nodeId?: string;
    reduceNode?: (node: GraphNode<any>) => any;
  } = {}
) {
  await openCocoonFile(definitionPath);
  const graph = await (nodeId ? processNodeById(nodeId) : processAllNodes());
  return graph.nodes.reduce((all, node) => {
    all[node.id] = reduceNode(node);
    return all;
  }, {}) as object;
}

/**
 * Creates an IPC server and handlers for incoming messages.
 */
export async function initialise() {
  // Run IPC server and register IPC events
  const server = await createServer(
    WebSocket as any,
    22244,
    Debug('cocoon:ipc')
  );
  state.server = server;
  setupLogForwarding(Debug, emitLog.bind(null, state.server));

  onOpenCocoonFile(server, async args => {
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
        emitUpdateCocoonFile(server, { contents: state.cocoonFileInfo!.raw });
        watchCocoonFile();
      }
    }
  });

  onUpdateCocoonFile(server, async args => {
    if (args && args.contents) {
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

  onRequestCocoonFile(server, () => ({
    contents: state.cocoonFileInfo ? state.cocoonFileInfo.raw : undefined,
  }));

  onProcessNode(server, args => {
    const { nodeId } = args;
    processNodeById(nodeId);
  });

  onProcessNodeIfNecessary(server, args => {
    const { nodeId } = args;
    processNodeByIdIfNecessary(nodeId);
  });

  onStopExecutionPlan(server, () => {
    cancelActiveExecutionPlan(state.planner);
  });

  onRequestPortData(server, async args => {
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

  onDumpPortData(server, async args => {
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
  onSyncNode(server, args => {
    const { serialisedNode } = args;
    const node = requireGraphNode(_.get(serialisedNode, 'id'), state.graph!);
    debug(`syncing node "${node.id}"`);
    _.assign(node, deserialiseNode(serialisedNode));
  });

  onRequestNodeSync(server, args => {
    const { nodeId, syncId } = args;
    if (state.graph) {
      const node = requireGraphNode(nodeId, state.graph);
      if (syncId === undefined || syncId !== node.syncId) {
        return { serialisedNode: syncNode(node) };
      }
    }
    // Ignore request if there's no graph, since data views will send these
    // requests regardless
    return { serialisedNode: null };
  });

  onCreateView(server, async args => {
    const { nodeId, type, port } = args;
    debug(`creating new view of type "${type}"`);
    const node = requireGraphNode(nodeId, state.graph!);
    assignViewDefinition(node.definition, type, port);
    invalidateViewCache(node, false);
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
    await processNodeById(args.nodeId);
  });

  onRemoveView(server, async args => {
    const { nodeId } = args;
    debug(`removing view for "${nodeId}"`);
    const node = requireGraphNode(nodeId, state.graph!);
    removeViewDefinition(node.definition);
    invalidateViewCache(node, false);
    await updateCocoonFileAndNotify();
    await reparseCocoonFile();
  });

  // If the node view state changes (due to interacting with the data view
  // window of a node), re-processes the node
  onChangeNodeViewState(server, args => {
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

  onRequestNodeView(server, args => {
    const { nodeId, query } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    const context = createNodeContextFromState(node);
    return respondToViewQuery(node, state.registry!, context, query);
  });

  onRequestNodeViewData(server, args => {
    const { nodeId } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    return { viewData: node.state.viewData };
  });

  onHighlightInViews(server, args => {
    emitHighlightInViews(server, args);
  });

  onInvalidateNodeCache(server, args => {
    if (state.graph) {
      if (!args) {
        state.graph.nodes.forEach(node => {
          invalidateNodeCache(node, true);
        });
      } else if (args.nodeId) {
        const node = requireGraphNode(args.nodeId, state.graph);
        args.downstream
          ? invalidateNodeCacheDownstream(node, true)
          : invalidateNodeCache(node, true);
      }
    }
  });

  onCreateNode(server, async args => {
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

  onRemoveNode(server, async args => {
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

  onCreateEdge(server, async args => {
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

  onRemoveEdge(server, async args => {
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

  onClearPersistedCache(server, async args => {
    const { nodeId } = args;
    const node = requireGraphNode(nodeId, state.graph!);
    clearPersistedCache(node, state.cocoonFileInfo!);
  });

  onRequestMemoryUsage(server, () => ({
    memoryUsage: process.memoryUsage(),
  }));

  onRunProcess(server, args => {
    spawnChildProcess(args.command, {
      args: args.args,
      cwd: state.cocoonFileInfo!.root,
      debug,
    }).catch(error => {
      logAndEmitError(error, true);
    });
  });

  onPurgeCache(server, () => {
    state
      .graph!.nodes.filter(node => nodeIsCached(node))
      .forEach(node => invalidateNodeCache(node));
  });

  onSendToNode(server, args => {
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

  onShiftPositions(server, async args => {
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

  onOpenFile(server, args => {
    open(args.uri);
  });

  onRequestRegistry(server, () => ({ registry: state.registry! }));

  onReloadRegistry(server, () => {
    delete state.registry;
    reparseCocoonFile();
  });

  // Catch all errors
  process.title = 'cocoon';
  process
    .on('unhandledRejection', error => {
      if (error) {
        logAndEmitError(error, false);
        throw error;
      }
      throw new Error('unhandled rejection');
    })
    .on('uncaughtException', error => {
      logAndEmitError(error);
    });
}

async function createNodeProcessor(node: GraphNode) {
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

    // Override output data with static output port assignments from definitions
    if (node.definition.out) {
      writeToPorts(node, node.definition.out);
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
        logAndEmitError(error, true);
      }
    }

    // Update status
    node.state.status = NodeStatus.processed;
  } catch (error) {
    node.state.error = error;
    node.state.status = NodeStatus.error;
  } finally {
    // It's a bit questionable to delete the processor here. Since it was
    // attached in the planner it should also get removed there. But the Promise
    // interface has no way to query the status of a promise, so the planner has
    // no way of knowing if processing has indeed finished.
    delete node.state.processor;
    // Sync and emit error at the end (and not in the catch block), to
    // absolutely make sure that the processor is deleted before starting any
    // potentially error-prone operations. If we fail to delete the processor,
    // the planner will wait forever for it to finish and the entire process
    // will be stuck as a consequence (since it won't know if the promise has
    // been resolved).
    syncNode(node);
    if (node.state.error) {
      logAndEmitError(
        node.state.error,
        true,
        maybeContext ? (maybeContext.debug as Debug.Debugger) : debug
      );
    }
  }
}

async function scheduleNodeProcessing(nodeOrNodes: GraphNode | GraphNode[]) {
  state.previousPlannerError = null;
  try {
    await createAndExecutePlanForNodes(
      state.planner,
      nodeOrNodes,
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
  } catch (error) {
    logAndEmitError(error, true);
    state.previousPlannerError = error;
  }
}

function markNodeAsScheduled(node: GraphNode, sync = true) {
  node.state.scheduled = true;
  if (sync && state.server) {
    emitSyncNode(state.server, { serialisedNode: serialiseNode(node) });
  }
}

function markNodeAsNotScheduled(node: GraphNode, sync = true) {
  node.state.scheduled = false;
  if (sync && state.server) {
    emitSyncNode(state.server, { serialisedNode: serialiseNode(node) });
  }
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
    if (sync && state.server) {
      emitUpdateNodeProgress(state.server, node.id, { summary, percent });
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
    if (state.server) {
      if (updateLayout) {
        debug('graph changed, syncing');
        emitSyncGraph(state.server, {
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
            emitSyncNode(state.server!, {
              serialisedNode: serialiseNode(x.next),
            });
          });
      }
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
        debug(`restoring persisted cache for "${node.id}"`);
        node.state.processor = restore;
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
        delete node.state.processor;
        await updateView(
          node,
          state.registry!,
          createNodeContextFromState(node)
        );
      });

    // Sync graph (loading the persisted cache can take a long time, so we sync
    // the graph already and update the nodes that were restored individually)
    if (state.server) {
      emitSyncGraph(state.server, {
        registry: state.registry!,
        serialisedGraph: serialiseGraph(nextGraph),
      });
    }
  }

  // Reset errors
  logAndEmitError(null);

  // Commit graph
  state.graph = nextGraph;
  state.previousFileInfo = _.cloneDeep(state.cocoonFileInfo);

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
      if (state.server) {
        emitUpdateCocoonFile(state.server, {
          contents: state.cocoonFileInfo!.raw,
        });
      }
    });
  }
}

async function updateCocoonFileAndNotify() {
  debug(`updating Cocoon file`);
  updateCocoonFileFromGraph(state.graph!, state.cocoonFileInfo!.parsed!);
  unwatchCocoonFile();
  const contents = yaml.dump(state.cocoonFileInfo!.parsed, {
    noCompatMode: true,
    noRefs: true,
    sortKeys: true,
  });
  await fs.promises.writeFile(state.cocoonFileInfo!.path, contents);
  debug(`updated Cocoon file at "${state.cocoonFileInfo!.path}"`);
  watchCocoonFile();

  // Notify the client that the definition changed
  if (state.server) {
    emitUpdateCocoonFile(state.server, { contents });
  }

  return contents;
}

function syncNode(node: GraphNode) {
  const serialisedNode = serialiseNode(node);
  node.syncId = Date.now();
  if (state.server) {
    emitSyncNode(state.server, { serialisedNode });
  }
  return serialiseNode;
}

function logAndEmitError(
  error: Error | {} | string | null | undefined,
  ignore = false,
  debugInstance: Debug.Debugger = debug
) {
  if (error) {
    if (typeof error === 'string') {
      console.error(error);
    } else if ('message' in error) {
      console.error(error.message, error);
    } else {
      console.error(error.toString());
    }
  }
  if (state.server) {
    emitError(state.server, {
      error: error
        ? serializeError(typeof error === 'string' ? new Error(error) : error)
        : null,
      ignore,
      namespace: debugInstance.namespace,
    });
  }
}
