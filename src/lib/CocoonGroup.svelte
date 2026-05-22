<script lang="ts">
  import type { Node, NodeProps } from '@xyflow/svelte';

  // Display-only container for a `group:` path. Not a real Cocoon node:
  // no ports, no status, not runnable. Sized + positioned by the Dagre
  // compound pass; this component just draws the titled box. The deepest
  // path segment is the visible title (full path in the tooltip).
  let { data }: NodeProps<Node<{ label: string; path: string }>> = $props();
</script>

<div class="cocoon-group" title={data.path}>
  <span class="title">{data.label}</span>
</div>

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
</style>
