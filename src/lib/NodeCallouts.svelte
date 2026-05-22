<script lang="ts">
  import type { Callout } from './protocol';

  /**
   * Always-visible speech-bubble cluster sitting directly above a node.
   * Stacks vertically with the freshest closest to the node (it carries the
   * tail); the cluster's tail tone follows the worst severity so a single
   * error pulls the eye even in a mixed stack.
   *
   * Lives OUTSIDE the node's `.body` (which has `overflow: hidden`) so it can
   * spill above. Positions relative to `.cocoon-node` (the wrapping host
   * provides `position: relative`).
   */
  let {
    items,
    onDismiss,
  }: {
    items: (Callout & { label?: string })[];
    onDismiss: (id: string) => void;
  } = $props();

  const toneClass = (t: 'info' | 'warn' | 'error' | undefined) =>
    t === 'error' ? 'tone-error' : t === 'warn' ? 'tone-warn' : 'tone-info';
  const worstTone = $derived(
    items.some(c => c.tone === 'error')
      ? 'error'
      : items.some(c => c.tone === 'warn')
        ? 'warn'
        : 'info'
  );

  // Buttons live inside SvelteFlow — its canvas-level node-click would also
  // fire `process()`. Swallow so a click does exactly one thing.
  const stop = (e: MouseEvent, run: () => void) => {
    e.stopPropagation();
    run();
  };
</script>

{#if items.length}
  <div
    class="callouts nodrag nopan tail-{worstTone}"
    role="group"
    aria-label="{items.length} agent callout{items.length === 1 ? '' : 's'}"
  >
    {#each items as c (c.id)}
      <div class="callout-bubble {toneClass(c.tone)}">
        <span class="lbl" title={c.from ? `from ${c.from}` : undefined}
          >{c.label ?? '?'}</span
        >
        <span class="msg">{c.message}</span>
        <button
          type="button"
          class="dismiss"
          aria-label="Dismiss callout {c.label ?? ''}"
          title="Dismiss"
          onclick={e => stop(e, () => onDismiss(c.id))}>✕</button
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .callouts {
    position: absolute;
    bottom: calc(100% + 7px);
    left: 0;
    right: 0;
    z-index: 7;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    pointer-events: auto;
  }
  .tone-info {
    color: #fbbf24;
  }
  .tone-warn {
    color: #fb923c;
  }
  .tone-error {
    color: #f87171;
  }
  .callout-bubble {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 5px;
    align-items: baseline;
    padding: 2px 5px 2px 6px;
    background: #0b0b0fee;
    border: 1px solid currentColor;
    border-radius: 6px;
    box-shadow: 0 3px 10px #0006;
    font-size: 9.5px;
    line-height: 1.35;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .callout-bubble .lbl {
    font-weight: 700;
    color: currentColor;
    letter-spacing: 0.02em;
    font-size: 9px;
  }
  .callout-bubble .msg {
    color: #d4d4d8;
  }
  .callout-bubble .dismiss {
    background: transparent;
    color: #71717a;
    border: 0;
    cursor: pointer;
    padding: 0 2px;
    font-size: 10px;
    line-height: 1;
    align-self: start;
  }
  .callout-bubble .dismiss:hover {
    color: #fff;
  }
  /* Downward tail on the bubble closest to the node. Two pseudo-elements
     stack: the outer (border tint) sits one pixel behind the inner (bubble
     fill) so a 1px outline appears around the triangle. */
  .callouts > .callout-bubble:last-child {
    position: relative;
  }
  .callouts > .callout-bubble:last-child::before,
  .callouts > .callout-bubble:last-child::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 12px;
    width: 0;
    height: 0;
    border: 6px solid transparent;
    border-bottom: 0;
  }
  .callouts > .callout-bubble:last-child::before {
    border-top-color: currentColor;
    transform: translate(-1px, 0);
    border-left-width: 7px;
    border-right-width: 7px;
  }
  .callouts.tail-info > .callout-bubble:last-child::before {
    color: #fbbf24;
  }
  .callouts.tail-warn > .callout-bubble:last-child::before {
    color: #fb923c;
  }
  .callouts.tail-error > .callout-bubble:last-child::before {
    color: #f87171;
  }
  .callouts > .callout-bubble:last-child::after {
    border-top-color: #0b0b0f;
    transform: translateY(-1px);
  }
</style>
