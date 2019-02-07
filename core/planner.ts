import _ from 'lodash';
import { GraphNode, nodeIsCached, resolveUpstream } from '../common/graph';

const debug = require('../common/debug')('core:planner');
const nodeProcessors = new Map<string, Promise<void>>();
let activePlan: ExecutionPlan | null = null;

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
  const nodesToProcess = resolveUpstream(node, n => !nodeIsCached(n));
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
  resolveUpstream(node, n => !nodeIsCached(n)).forEach(n => {
    if (!plan.nodeMap.has(n.id)) {
      plan.nodeMap.set(n.id, n);
      plan.nodesToProcess.push(n);
    }
  });
}

export async function runExecutionPlan(
  plan: ExecutionPlan,
  process: NodeProcessor
) {
  let notFinished = true;
  while (notFinished) {
    notFinished = await processPlannedNodes(plan, process);
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
