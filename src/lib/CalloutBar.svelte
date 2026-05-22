<script lang="ts">
  import type { Callout } from './protocol';

  let {
    visible,
    cursor,
    labels,
    onStep,
  }: {
    visible: Callout[];
    cursor: number;
    labels: Map<string, string>;
    onStep: (delta: 1 | -1) => void;
  } = $props();
</script>

{#if visible.length}
  <div
    class="callout-bar"
    role="group"
    aria-label="Agent callouts"
    title={visible[cursor]
      ? `${labels.get(visible[cursor].id) ?? ''} on ${visible[cursor].node} — ${visible[cursor].message}`
      : ''}
  >
    <button
      class="caret"
      aria-label="Previous callout"
      title="Previous callout"
      disabled={visible.length < 2}
      onclick={() => onStep(-1)}>◀</button
    >
    <span class="count" aria-live="polite">
      {#if visible.length > 1}
        {labels.get(visible[cursor]?.id) ?? '?'}
        <span class="of">{cursor + 1}/{visible.length}</span>
      {:else}
        {labels.get(visible[0].id) ?? '?'}
      {/if}
    </span>
    <button
      class="caret"
      aria-label="Next callout"
      title="Next callout"
      disabled={visible.length < 2}
      onclick={() => onStep(1)}>▶</button
    >
  </div>
{/if}

<style>
  .callout-bar {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: -8px;
    padding: 1px 4px;
    border-radius: 999px;
    border: 1px solid #fbbf2455;
    background: #fbbf2410;
  }
  .caret {
    margin: 0;
    padding: 1px 6px;
    font-size: 11px;
    line-height: 1;
    background: transparent;
    color: #fbbf24;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
  }
  .caret:not(:disabled):hover {
    background: #fbbf2422;
  }
  .caret:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .count {
    color: #fde68a;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.02em;
    padding: 0 2px;
  }
  .count .of {
    color: #a1a1aa;
    font-weight: 400;
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }
</style>
