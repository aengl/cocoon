<script lang="ts">
  /**
   * Floating contextual-action toolbar. Hidden until the node is hovered or
   * keyboard-focused so the canvas stays uncluttered.
   *
   * The MouseEvent is forwarded so an action can read modifier keys
   * (shift-click "run" → `process(id, { rerunStale: true })`).
   */
  export type ToolbarAction = {
    key: string;
    title: string;
    icon: string;
    active?: boolean;
    run: (e?: MouseEvent) => void;
  };

  let { actions }: { actions: ToolbarAction[] } = $props();

  const fire = (e: MouseEvent, run: (e?: MouseEvent) => void) => {
    // Swallow so the canvas-level node-click doesn't also fire `process()`.
    e.stopPropagation();
    run(e);
  };
</script>

{#if actions.length}
  <div class="node-actions nodrag nopan">
    {#each actions as a (a.key)}
      <button
        type="button"
        class="act"
        class:active={a.active}
        title={a.title}
        aria-label={a.title}
        aria-pressed={a.active ?? undefined}
        onclick={e => fire(e, a.run)}
      >
        <span class="ico">{@html a.icon}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .node-actions {
    position: absolute;
    top: 5px;
    right: 5px;
    z-index: 5;
    display: flex;
    gap: 3px;
    padding: 3px;
    border-radius: 7px;
    background: #0d0d0fe6;
    border: 1px solid #3f3f46;
    box-shadow: 0 2px 10px #000a;
    opacity: 0;
    transform: translateY(-3px);
    pointer-events: none;
    transition:
      opacity 0.12s,
      transform 0.12s;
  }
  /* Reveal on the parent node's hover/focus — `:global` selectors so the
     trigger lives on `.cocoon-node` (the host component, outside scope). */
  :global(.cocoon-node:hover) .node-actions,
  :global(.cocoon-node:focus-within) .node-actions {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  .act {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: #27272a;
    color: #d4d4d8;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .act:hover {
    background: #3f3f46;
    color: #fff;
  }
  .act:active {
    transform: translateY(1px);
  }
  .act.active {
    background: #14532d;
    color: #4ade80;
  }
  .act.active:hover {
    background: #166534;
    color: #86efac;
  }
  .ico {
    display: grid;
    place-items: center;
  }
  .ico :global(svg) {
    display: block;
  }
</style>
