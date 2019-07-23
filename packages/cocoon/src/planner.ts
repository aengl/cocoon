import { Graph, GraphNode } from '@cocoon/types';
import requireGraphNode from '@cocoon/util/requireGraphNode';
import _ from 'lodash';
import { nodeIsCached, nodeNeedsProcessing, resolveUpstream } from './graph';

const debug = require('debug')('cocoon:planner');

const nodeProcessors = new Map<string, Promise<any>>();
let activePlan: ExecutionPlan | null = null;
let updateActivePlan: DeferredPromise<boolean> | null = null;

export interface ExecutionPlan {
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
  afterPlanning?: (plan: ExecutionPlan) => void;

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
}

export type NodeProcessor = (node: GraphNode) => Promise<any>;

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
  nodeOrNodes: GraphNode | GraphNode[],
  process: NodeProcessor,
  graph: Graph,
  options: PlannerOptions = {}
) {
  const nodes = _.castArray(nodeOrNodes);
  if (nodes.length === 0) {
    return;
  }
  if (!activePlan) {
    activePlan = createExecutionPlan(graph, options);
    nodes.forEach(node =>
      appendToExecutionPlan(activePlan!, node, options.nodeNeedsProcessing)
    );
    if (options.afterPlanning) {
      options.afterPlanning(activePlan);
    }
    await runExecutionPlan(activePlan, process);
    activePlan = null;
    updateActivePlan = null;
  } else {
    nodes.forEach(node =>
      appendToExecutionPlan(activePlan!, node, options.nodeNeedsProcessing)
    );
  }
}

export function createExecutionPlan(
  graph: Graph,
  options: PlannerOptions
): ExecutionPlan {
  debug(`creating a new execution plan`);
  return {
    graph,
    nodeAdded: options.nodeAdded || _.noop,
    nodeMap: new Map(),
    nodeRemoved: options.nodeRemoved || _.noop,
    nodesToProcess: [],
  };
}

export function appendToExecutionPlan(
  plan: ExecutionPlan,
  node: GraphNode,
  nodeNeedsProcessingCallback: (
    node: GraphNode
  ) => boolean = nodeNeedsProcessing
) {
  if (plan.nodeMap.has(node.id)) {
    return; // Node is already part of the execution plan
  }

  debug(`adjusted exection plan to include "${node.id}"`);
  resolveUpstream(node, plan.graph, nodeNeedsProcessingCallback)
    .filter(n => !plan.nodeMap.has(n.id))
    .forEach(n => {
      plan.nodeMap.set(n.id, n);
      plan.nodesToProcess.push(n);
      plan.nodeAdded(n);
    });

  plan.nodeAdded(node);

  if (updateActivePlan) {
    // We're in a complicated situation -- the plan is already being executed,
    // but the newly appended node might qualify for immediate execution as
    // well. Since we don't want to cancel our plan, we use a deferred promise
    // to resolve the current iteration in the plan's execution, so it is
    // forced to re-evaluate what nodes to execute.
    updateActivePlan.resolve(true);
  }
}

export async function runExecutionPlan(
  plan: ExecutionPlan,
  process: NodeProcessor
) {
  debug(`processing ${plan.nodesToProcess.length} nodes`);
  let notFinished = true;
  while (notFinished) {
    updateActivePlan = defer();
    // Wait for a node to finish, or the deferred promise to resolve. The
    // deferred p romise allows us to reject (and thus stop) the plan's
    // execution, or re-evaluate the current iteration in case the plan was
    // modified.
    notFinished = await Promise.race([
      processPlannedNodes(plan, process),
      updateActivePlan.promise,
    ]);
  }
}

async function processPlannedNodes(
  plan: ExecutionPlan,
  process: NodeProcessor
) {
  // Find nodes that have all their prerequisite nodes cached
  const nodes = plan.nodesToProcess.filter(
    node =>
      !node.edgesIn.some(
        edge => !nodeIsCached(requireGraphNode(edge.from, plan.graph))
      )
  );

  // If we can't process any nodes yet, wait for any of the currently running
  // processors to finish
  if (nodes.length === 0 && nodeProcessors.size > 0) {
    await Promise.race([...nodeProcessors.values()]);
    return true;
  }

  // Report if the execution plan stops prematurely -- this will usually happen
  // if a prerequisite node ran into an error
  if (nodes.length === 0 && plan.nodesToProcess.length > 0) {
    debug(
      `execution plan stopped early, with ${plan.nodesToProcess.length} nodes left to process`,
      plan.nodesToProcess
    );
    // We still need to notify that the nodes are no longer scheduled
    plan.nodesToProcess.forEach(n => plan.nodeRemoved(n));
    return false;
  }

  // Remove nodes from plan
  _.pull(plan.nodesToProcess, ...nodes);
  nodes.forEach(n => plan.nodeRemoved(n));

  // Create node processors
  const processors = nodes.map(node => wrapNodeProcessor(node, process));

  // Trigger callbacks
  if (processors.length > 0) {
    // Don't wait for all processors, we want to continue the execution planning
    // as soon as one processor is finished
    await Promise.race(processors);
    return true;
  }

  return false;
}

async function wrapNodeProcessor(node: GraphNode, process: NodeProcessor) {
  const existingProcessor = nodeProcessors.get(node.id);
  if (existingProcessor !== undefined) {
    // If this node is already being processed, re-use the existing processor to
    // make sure the node isn't evaluated multiple times in parallel
    await existingProcessor;
  } else {
    const processor = process(node);
    nodeProcessors.set(node.id, processor);
    await processor;
    nodeProcessors.delete(node.id);
  }
}

interface DeferredPromise<T> {
  promise: Promise<T>;
  reject: (x?: T) => void;
  resolve: (x?: T) => void;
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
