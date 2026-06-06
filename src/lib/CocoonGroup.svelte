<script lang="ts">
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import { useNodeActions } from './nodeActions';
  import { STATUS_COLOR } from './edgeDecor';
  import type { MiniGraph } from './layout';
  import type { NodeStatus } from './protocol';

  // Display-only container for a `group:` path. Not a real Cocoon node:
  // no ports, no status, not runnable. Sized + positioned by the Dagre
  // compound pass; this component just draws the box. The deepest path
  // segment is the visible title (full path in the tooltip).
  //
  // Collapse: the header toggle folds the group to a small box that renders a
  // *minimap of the group's own DAG* — its members as status squares, wired by
  // their intra-group edges, in dependency order (no labels). `collapsed`/
  // `memberIds`/`mini` come from `layout`; `statuses` is injected by App from
  // the live node states. The box was sized to fit `mini` exactly in layout.ts.
  let { data }: NodeProps<
    Node<{
      label: string;
      path: string;
      collapsed?: boolean;
      memberIds?: string[];
      statuses?: NodeStatus[];
      mini?: MiniGraph;
    }>
  > = $props();

  const actions = useNodeActions();
  const statuses = $derived(data.statuses ?? []);
  const mini = $derived(data.mini);
  // Edge endpoints are square centres.
  const cx = (i: number) => (mini ? mini.pos[i].x + mini.node / 2 : 0);
  const cy = (i: number) => (mini ? mini.pos[i].y + mini.node / 2 : 0);

  // Stop the pointerdown from starting an xyflow node-drag so the button
  // clicks cleanly; the surrounding box still drags from its body/padding.
  const stopDrag = (e: PointerEvent) => e.stopPropagation();
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    actions?.toggleCollapse(data.path);
  };
</script>

{#if data.collapsed}
  <div class="cocoon-group collapsed" title={data.path}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <div class="head">
      <button
        class="toggle"
        title="Expand group"
        aria-label="Expand group"
        onpointerdown={stopDrag}
        onclick={toggle}>+</button
      >
      <span class="ctitle">{data.label}</span>
    </div>
    {#if mini}
      <svg
        class="mini"
        width={mini.w}
        height={mini.h}
        viewBox="0 0 {mini.w} {mini.h}"
      >
        {#each mini.edges as [a, b] (a + '-' + b)}
          <line x1={cx(a)} y1={cy(a)} x2={cx(b)} y2={cy(b)} />
        {/each}
        {#each mini.pos as p, i (i)}
          <rect
            x={p.x}
            y={p.y}
            width={mini.node}
            height={mini.node}
            rx={Math.min(4, mini.node / 3)}
            fill={STATUS_COLOR[statuses[i] ?? 'idle']}
          />
        {/each}
      </svg>
    {/if}
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>
{:else}
  <div class="cocoon-group" title={data.path}>
    <span class="title">{data.label}</span>
    <button
      class="toggle expanded-toggle"
      title="Collapse group"
      aria-label="Collapse group"
      onpointerdown={stopDrag}
      onclick={toggle}>−</button
    >
  </div>
{/if}

<style>
  .cocoon-group {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 1px dashed #52525b;
    border-radius: 10px;
    background: #a1a1aa0a;
    /* Only the empty padding drags the whole group — child nodes sit at
       a higher z, so a click on a child still hits the child. */
    pointer-events: all;
    cursor: grab;
  }
  .cocoon-group:active {
    cursor: grabbing;
  }
  .title {
    position: absolute;
    top: 6px;
    left: 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #a1a1aa;
    background: #09090bcc;
    padding: 1px 7px;
    border-radius: 5px;
    pointer-events: none;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: #09090bcc;
    color: #a1a1aa;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }
  .toggle:hover {
    color: #e4e4e7;
    background: #27272a;
  }
  .expanded-toggle {
    position: absolute;
    top: 5px;
    right: 8px;
  }

  /* Collapsed: a title strip over a minimap of the group's DAG. Padding mirrors
     COLLAPSE in layout.ts and the <svg> is sized to MINI so the box fits
     exactly (no measure round-trip). */
  .collapsed {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 14px 14px;
    background: #18181b;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 16px;
  }
  .ctitle {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #a1a1aa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  .mini {
    display: block;
    pointer-events: none;
  }
  .mini line {
    stroke: #52525b;
    stroke-width: 1.5;
  }
</style>
