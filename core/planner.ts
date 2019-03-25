import _ from 'lodash';
import {
  GraphNode,
  nodeIsCached,
  nodeNeedsProcessing,
  resolveUpstream,
} from '../common/graph';

const debug = require('../common/debug')('core:planner');
const nodeProcessors = new Map<string, Promise<any>>();
let activePlan: ExecutionPlan | null = null;
let updateActivePlan: DeferredPromise<boolean>;

export interface ExecutionPlan {
  nodeMap: Map<string, GraphNode>;
  nodesToProcess: GraphNode[];
}

export interface PlannerOptions {
  beforePlanning?: () => void;
  afterPlanning?: (plan: ExecutionPlan) => void;
}

export type NodeProcessor = (node: GraphNode) => Promise<any>;

/**
 * Creates a plan to process a node, processing all uncached prerequisite nodes
 * as necessary (if possible in parallel). If a plan is already currently
 * active, it will append the node to the active plan instead.
 *
 * If the node already has a cached result, this function will do nothing. In
 * this case, you can use the `beforePlanning` callback in the `options`
 * argument to invalidate the node cache before the execution plan is created.
 * @param node The node that will be processed.
 * @param process The node processing function, called for the node and all
 * prerequisites.
 * @param options Optional configuration.
 */
export async function createAndExecutePlanForNode(
  node: GraphNode,
  process: NodeProcessor,
  options: PlannerOptions = {}
) {
  if (!activePlan) {
    if (options.beforePlanning) {
      options.beforePlanning();
    }
    activePlan = createExecutionPlan(node);
    if (options.afterPlanning) {
      options.afterPlanning(activePlan);
    }
    await runExecutionPlan(activePlan, process);
    activePlan = null;
  } else {
    appendToExecutionPlan(activePlan, node);
  }
}

/**
 * Same `createAndExecutePlanForNode`, but for multiple nodes.
 */
export async function createAndExecutePlanForNodes(
  nodes: GraphNode[],
  process: NodeProcessor,
  options: PlannerOptions = {}
) {
  if (nodes.length === 0) {
    return;
  }
  if (!activePlan) {
    if (options.beforePlanning) {
      options.beforePlanning();
    }
    activePlan = createExecutionPlan();
    nodes.forEach(node => appendToExecutionPlan(activePlan!, node));
    if (options.afterPlanning) {
      options.afterPlanning(activePlan);
    }
    await runExecutionPlan(activePlan, process);
    activePlan = null;
  } else {
    nodes.forEach(node => appendToExecutionPlan(activePlan!, node));
  }
}

export function createExecutionPlan(node?: GraphNode): ExecutionPlan {
  if (!node) {
    return {
      nodeMap: new Map(),
      nodesToProcess: [],
    };
  }
  debug(`creating execution plan for "${node.id}"`);

  // Create node path
  const nodesToProcess = resolveUpstream(node, nodeNeedsProcessing);
  if (nodesToProcess.length === 0) {
    // If all upstream nodes are cached or the node is a starting node, the path
    // will be an empty array. In that case, process the target node only.
    nodesToProcess.push(node);
  }
  debug(`processing ${nodesToProcess.length} nodes`);

  // Map nodes in path
  const nodeMap = nodesToProcess.reduce((map, n) => {
    map.set(n.id, n);
    return map;
  }, new Map<string, GraphNode>());

  return {
    nodeMap,
    nodesToProcess,
  };
}

export function appendToExecutionPlan(plan: ExecutionPlan, node: GraphNode) {
  resolveUpstream(node, nodeNeedsProcessing)
    .filter(n => !plan.nodeMap.has(n.id))
    .forEach(n => {
      plan.nodeMap.set(n.id, n);
      plan.nodesToProcess.push(n);
    });

  if (activePlan) {
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
    node => !node.edgesIn.some(edge => !nodeIsCached(edge.from))
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
    console.warn(
      `Execution plan stopped early, with ${
        plan.nodesToProcess.length
      } nodes left to process`,
      plan.nodesToProcess
    );
    return false;
  }

  // Remove nodes from plan
  _.pull(plan.nodesToProcess, ...nodes);

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
