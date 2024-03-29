import { Graph, GraphNode } from '@cocoon/types';
import requireGraphNode from '@cocoon/util/requireGraphNode';
import _ from 'lodash';
import { nodeIsCached, nodeNeedsProcessing, resolveUpstream } from './graph';

const debug = require('debug')('cocoon:planner');

export interface ExecutionPlannerState {
  activePlan?: ExecutionPlan | null;
  updateActivePlan?: DeferredPromise<boolean> | null;
}

export interface ExecutionPlan {
  canceled: boolean;
  graph: Graph;
  nodeMap: Map<string, GraphNode>;
  nodesToProcess: GraphNode[];
  nodeAdded: (node: GraphNode) => void;
  nodeRemoved: (node: GraphNode) => void;
}

export interface PlannerOptions {
  /**
   * Allows modification of the execution plan before it is executed.
   */
  afterPlanning?: () => void;

  /**
   * Called whenever a node is added to the plan.
   */
  nodeAdded?: (node: GraphNode) => void;

  /**
   * Callback for determining if a node needs to be processed. By default, it
   * uses the `nodeNeedsProcessing` function from the graph module.
   */
  nodeNeedsProcessing?: (node: GraphNode) => boolean;

  /**
   * Called whenever a node is removed from the plan (either because it is being
   * processed, or because the plan failed).
   */
  nodeRemoved?: (node: GraphNode) => void;

  /**
   * Called when a plan stops prematurely
   */
  planCanceled?: (unprocessedNodes: GraphNode[]) => void;
}

export type NodeProcessor = (node: GraphNode) => Promise<any>;

interface DeferredPromise<T> {
  promise: Promise<T>;
  reject: (x?: T) => void;
  resolve: (x?: T) => void;
}

export function initialiseExecutionPlanner(): ExecutionPlannerState {
  return {
    activePlan: null,
    updateActivePlan: null,
  };
}

/**
 * Creates a plan to process or or more nodes, processing all uncached
 * prerequisite nodes as necessary (if possible in parallel). If a plan is
 * already currently active, it will append the nodes to the active plan
 * instead.
 *
 * If all nodes already have a cached result, this function will do nothing. In
 * this case, you invalidate the node cache prior to calling this function.
 * @param nodeOrNodes The node or nodes that will be processed.
 * @param process The node processing function, called for the node and all
 * prerequisites.
 * @param options Optional configuration.
 */
export async function createAndExecutePlanForNodes(
  state: ExecutionPlannerState,
  nodeOrNodes: GraphNode | GraphNode[],
  process: NodeProcessor,
  graph: Graph,
  options: PlannerOptions = {}
) {
  const nodes = _.castArray(nodeOrNodes);
  if (nodes.length === 0) {
    return;
  }
  if (!state.activePlan) {
    state.activePlan = createExecutionPlan(graph, options);
    nodes.forEach(node =>
      appendToExecutionPlan(state, node, options.nodeNeedsProcessing)
    );
    if (options.afterPlanning) {
      options.afterPlanning();
    }
    await runExecutionPlan(state, process);
    state.activePlan = null;
    state.updateActivePlan = null;
  } else {
    nodes.forEach(node =>
      appendToExecutionPlan(state, node, options.nodeNeedsProcessing)
    );
  }
}

export function createExecutionPlan(
  graph: Graph,
  options: PlannerOptions
): ExecutionPlan {
  // debug(`creating a new execution plan`);
  return {
    canceled: false,
    graph,
    nodeAdded: options.nodeAdded || _.noop,
    nodeMap: new Map(),
    nodeRemoved: options.nodeRemoved || _.noop,
    nodesToProcess: [],
  };
}

export function cancelActiveExecutionPlan(state: ExecutionPlannerState) {
  const plan = state.activePlan;
  if (plan) {
    plan.canceled = true;
  }
}

export function appendToExecutionPlan(
  state: ExecutionPlannerState,
  node: GraphNode,
  nodeNeedsProcessingCallback: (
    node: GraphNode
  ) => boolean = nodeNeedsProcessing
) {
  const plan = requireActivePlan(state);
  if (plan.nodeMap.has(node.id)) {
    return; // Node is already part of the execution plan
  }

  // debug(`adjusted exection plan to include "${node.id}"`);
  resolveUpstream(node, plan.graph, nodeNeedsProcessingCallback)
    .filter(n => !plan.nodeMap.has(n.id))
    .forEach(n => {
      plan.nodeMap.set(n.id, n);
      plan.nodesToProcess.push(n);
      plan.nodeAdded(n);
    });

  plan.nodeAdded(node);

  if (state.updateActivePlan) {
    // We're in a complicated situation -- the plan is already being executed,
    // but the newly appended node might qualify for immediate execution as
    // well. Since we don't want to cancel our plan, we use a deferred promise
    // to resolve the current iteration in the plan's execution, so it is
    // forced to re-evaluate what nodes to execute.
    state.updateActivePlan.resolve(true);
  }
}

export async function runExecutionPlan(
  state: ExecutionPlannerState,
  process: NodeProcessor
) {
  const plan = requireActivePlan(state);
  // debug(`processing ${plan.nodesToProcess.length} nodes`);
  let notFinished = true;
  while (notFinished && !plan.canceled) {
    state.updateActivePlan = defer();
    // Wait for a node to finish, or the deferred promise to resolve. The
    // deferred p romise allows us to reject (and thus stop) the plan's
    // execution, or re-evaluate the current iteration in case the plan was
    // modified.
    notFinished = await Promise.race([
      state.updateActivePlan.promise,
      processPlannedNodes(state, process),
    ]);
  }
  endExecutionPlan(state);
}

export async function endExecutionPlan(state: ExecutionPlannerState) {
  const plan = state.activePlan;
  if (!plan) {
    return;
  }

  // Report if the execution plan stopped prematurely
  if (plan.nodesToProcess.length > 0) {
    debug(
      `execution plan stopped prematurely, with ${plan.nodesToProcess.length} nodes left to process`,
      plan.nodesToProcess
    );
    // We still need to notify that the nodes are no longer scheduled
    plan.nodesToProcess.forEach(n => plan.nodeRemoved(n));
  } else {
    debug(`processed all planned nodes`);
  }

  // Clear up all references in the state
  delete state.activePlan;
  delete state.updateActivePlan;
}

async function processPlannedNodes(
  state: ExecutionPlannerState,
  process: NodeProcessor
) {
  const plan = requireActivePlan(state);

  // Find nodes that have all their prerequisite nodes cached
  const nodes = plan.nodesToProcess.filter(node =>
    node.edgesIn.every(edge =>
      nodeIsCached(requireGraphNode(edge.from, plan.graph))
    )
  );

  // If we can't process any nodes yet, wait for any of the currently running
  // processors to finish. Note that we're searching processors in the entire
  // graph, not just the planned nodes, because some prerequisite nodes to our
  // plan might still be processing (we don't include nodes that are currently
  // being processed in the planning since they'd just get processed again).
  const activeProcessors = plan.graph.nodes
    .map(x => x.state.processor)
    .filter(Boolean);
  if (nodes.length === 0 && activeProcessors.length > 0) {
    await Promise.race(activeProcessors);
    return true;
  }

  // Execution plan stopped prematurely -- this will usually happen if a
  // prerequisite node ran into an error
  if (nodes.length === 0 && plan.nodesToProcess.length > 0) {
    endExecutionPlan(state);
    throw new Error(`execution plan stopped prematurely`);
  }

  // Remove nodes from plan
  _.pull(plan.nodesToProcess, ...nodes);
  nodes.forEach(n => plan.nodeRemoved(n));

  // Create node processors
  const processors = nodes.map(node => {
    // If the node already has a processor attached, wait for that processor and
    // skip the processing stage. In practice, this most likely means that the
    // node is still restoring its persisted cache and got enqueued in an
    // execution plan before finishing.
    const processor = node.state.processor || process(node);
    node.state.processor = processor;
    return processor;
  });

  // Trigger callbacks
  if (processors.length > 0) {
    // Don't wait for all processors, we want to continue the execution planning
    // as soon as one processor is finished
    await Promise.race(processors);
    return true;
  }

  return false;
}

function requireActivePlan(state: ExecutionPlannerState) {
  if (!state.activePlan) {
    throw new Error(`No active execution plan`);
  }
  return state.activePlan;
}

/**
 * Uses the defer pattern to create a promise that can be resolved or rejected
 * externally.
 */
function defer<T>(): DeferredPromise<T> {
  const deferred = {
    promise: null,
    reject: null,
    resolve: null,
  } as any;
  deferred.promise = new Promise<T>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}
