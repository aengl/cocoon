import type { Edge } from '@xyflow/svelte';
import type { NodeState, NodeStatus } from './protocol';

export const STATUS_COLOR: Record<NodeStatus, string> = {
  idle: '#52525b',
  queued: '#3b82f6',
  running: '#f59e0b',
  done: '#22c55e',
  stale: '#eab308',
  error: '#ef4444',
};

export function decorate(
  base: Edge[],
  states: Record<string, NodeState>
): Edge[] {
  return base.map(e => {
    const src = states[e.source];
    const tgt = states[e.target];
    const count = src?.ports?.[e.sourceHandle ?? 'data'];
    return {
      ...e,
      animated: src?.status === 'running' || tgt?.status === 'running',
      label: count === undefined ? undefined : `${count}`,
      style: src
        ? `stroke:${STATUS_COLOR[src.status]};stroke-width:1.5`
        : undefined,
    } satisfies Edge;
  });
}
