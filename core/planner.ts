import _ from 'lodash';
import { GraphNode, nodeIsCached, resolveUpstream } from '../common/graph';

const debug = require('../common/debug')('core:planner');

export interface ExecutionPlan {
  nodeMap: Map<string, GraphNode>;
  nodesToProcess: GraphNode[];
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

export function processPlannedNodes(
  plan: ExecutionPlan,
  process: (node: GraphNode) => void
) {
  // Find nodes that have all their prerequisite nodes cached
  const nodes = plan.nodesToProcess.filter(
    node => !node.edgesIn.some(edge => !nodeIsCached(edge.from))
  );

  // Report if the execution plan stops prematurely
  if (nodes.length === 0 && plan.nodesToProcess.length > 0) {
    console.warn(
      `Execution plan stopped early, with ${
        plan.nodesToProcess.length
      } nodes left to process`,
      plan.nodesToProcess
    );
  }

  // Remove nodes from plan
  _.pull(plan.nodesToProcess, ...nodes);

  // Trigger callbacks
  if (nodes.length > 0) {
    nodes.forEach(node => process(node));
  }
}

export function planIsFinished(plan: ExecutionPlan) {
  return plan.nodesToProcess.length === 0;
}

export function planContainsNode(plan: ExecutionPlan, node: GraphNode) {
  return plan.nodeMap.has(node.id);
}
