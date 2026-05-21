<script lang="ts">
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';

  type Steering =
    | { kind: 'number'; label: string; value: number }
    | { kind: 'text'; label: string; value: string }
    | { kind: 'select'; label: string; value: string; options: string[] };

  type MockData = {
    label: string;
    nodeType: string;
    status: 'idle' | 'running' | 'done' | 'stale';
    doc?: string;
    params?: Array<[string, string]>;
    steering?: Steering[];
    bars?: Array<{ label: string; value: number }>;
    /**
     * Free-form inline control: a one-line headline (orange, big), a muted
     * summary line (HTML — can carry `<b>` for highlighted numbers), and an
     * optional primary "open chart" affordance.
     */
    freeform?: {
      headline?: string;
      summaryHtml?: string;
      action?: string;
    };
    statusMsg?: string;
    callout?: string;
    /** Hero scene: nodes pre-laid-out by dagre but faded in over time. */
    visible?: boolean;
    inPorts: string[];
    outPorts: string[];
  };

  let { data }: NodeProps<Node<MockData>> = $props();

  const offset = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;
</script>

<div
  class="cocoon-node status-{data.status}"
  class:hidden={data.visible === false}
>
  {#if data.callout}
    <div class="callouts tail-info" role="group">
      <div class="callout-bubble tone-info">
        <span class="lbl">C1</span>
        <span class="msg">{data.callout}</span>
        <button class="dismiss" type="button" tabindex="-1">✕</button>
      </div>
    </div>
  {/if}

  <div class="body">
    <header>
      <strong>{data.label}</strong>
      <span class="meta"><span class="type">{data.nodeType}</span></span>
    </header>

    {#if data.doc}
      <p class="doc">{data.doc}</p>
    {/if}

    {#if data.params?.length}
      <ul class="params">
        {#each data.params as [k, v] (k)}
          <li>
            <code class="pk">{k}</code>
            <span class="pv">{v}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if data.steering?.length}
      <section class="controls">
        {#each data.steering as c (c.label)}
          <label class="ctrl ctrl-{c.kind}">
            <span class="cl">{c.label}</span>
            {#if c.kind === 'number'}
              <input type="number" value={c.value} tabindex="-1" />
            {:else if c.kind === 'select'}
              <select tabindex="-1">
                {#each c.options as opt (opt)}
                  <option value={opt} selected={opt === c.value}>{opt}</option>
                {/each}
              </select>
            {:else}
              <input type="text" value={c.value} tabindex="-1" />
            {/if}
          </label>
        {/each}
      </section>
    {/if}

    {#if data.bars?.length}
      <section class="control">
        <div class="bars">
          {#each data.bars as b (b.label)}
            <div class="bar" style="height: {b.value}%"></div>
          {/each}
        </div>
        <div class="bars-labels">
          {#each data.bars as b (b.label)}
            <span>{b.label}</span>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.freeform}
      <section class="control freeform">
        {#if data.freeform.headline}
          <div class="ff-headline">{data.freeform.headline}</div>
        {/if}
        {#if data.freeform.summaryHtml}
          <p class="ff-summary">{@html data.freeform.summaryHtml}</p>
        {/if}
        {#if data.freeform.action}
          <button class="ff-action" type="button" tabindex="-1">{data.freeform.action}</button>
        {/if}
      </section>
    {/if}

    {#if data.status !== 'idle'}
      <footer class="status">
        <span class="dot"></span>
        <span class="label">{data.status}</span>
        {#if data.statusMsg}
          <span class="msg">{data.statusMsg}</span>
        {/if}
      </footer>
    {/if}
  </div>

  {#each data.inPorts as port, i (port)}
    <Handle
      type="target"
      position={Position.Left}
      id={port}
      style="top: {offset(i, data.inPorts.length)}"
    />
    <span class="port-label in" style="top: {offset(i, data.inPorts.length)}">{port}</span>
  {/each}

  {#each data.outPorts as port, i (port)}
    <Handle
      type="source"
      position={Position.Right}
      id={port}
      style="top: {offset(i, data.outPorts.length)}"
    />
    <span class="port-label out" style="top: {offset(i, data.outPorts.length)}">{port}</span>
  {/each}
</div>

<!--
  Copied subset of src/lib/CocoonNode.svelte's <style>. If the editor's node
  styling drifts, refresh this file before the next capture. Deliberate
  duplication: the mockup is meant to be self-contained.
-->
<style>
  .cocoon-node {
    position: relative;
    min-width: 200px;
    max-width: 260px;
    font-size: 12px;
    overflow: visible;
    opacity: 1;
    transition: opacity 0.4s ease;
  }
  .cocoon-node.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .body {
    position: relative;
    border: 1px solid var(--s, #3f3f46);
    border-radius: 8px;
    background: #18181b;
    color: #e4e4e7;
    overflow: hidden;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
    background: #27272a;
    border-bottom: 1px solid #3f3f46;
  }
  header strong {
    font-weight: 600;
  }
  .meta {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    margin-right: -3px;
  }
  .type {
    color: #a1a1aa;
    font-size: 11px;
    white-space: nowrap;
  }
  .doc {
    margin: 0;
    padding: 6px 10px;
    color: #a1a1aa;
    font-size: 11px;
    line-height: 1.4;
  }
  .params {
    margin: 0;
    padding: 6px 10px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid #27272a;
  }
  header + .params,
  header + .control,
  header + footer.status {
    border-top: none;
  }
  .params li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .params .pk {
    flex: none;
    background: #27272a;
    color: #93c5fd;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 11px;
  }
  .params .pv {
    flex: 1;
    min-width: 0;
    color: #d4d4d8;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Steering controls (keystone 5) — labelled inline knobs. */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid #27272a;
    background: #1c1c20;
  }
  header + .controls {
    border-top: none;
  }
  .ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .ctrl .cl {
    flex: none;
    color: #c4b5fd;
    font-size: 10.5px;
    min-width: 56px;
  }
  .ctrl input[type='text'],
  .ctrl input[type='number'],
  .ctrl select {
    flex: 1;
    min-width: 0;
    background: #0d0d0f;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 10.5px;
    font-family: inherit;
  }

  /* Free-form control area + the inline bar chart used by Bucket. */
  .control {
    padding: 8px 10px;
    border-top: 1px solid #27272a;
    background: #1c1c20;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 56px;
    margin: 2px 0 4px;
  }
  .bars .bar {
    flex: 1;
    background: #8b5cf6;
    border-radius: 2px 2px 0 0;
    opacity: 0.85;
  }
  .bars-labels {
    display: flex;
    gap: 4px;
    color: #71717a;
    font-size: 9px;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
  .bars-labels span {
    flex: 1;
    text-align: center;
  }

  /* Free-form summary + action button. */
  .freeform {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ff-headline {
    color: #f59e0b;
    font-size: 14px;
    font-weight: 700;
  }
  .ff-summary {
    margin: 0;
    color: #a1a1aa;
    font-size: 11px;
    line-height: 1.45;
  }
  .ff-summary :global(b) {
    color: #c4b5fd;
    font-weight: 600;
  }
  .ff-action {
    margin-top: 2px;
    background: #8b5cf6;
    color: #fff;
    border: 0;
    border-radius: 6px;
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: default;
  }

  /* Status colours. */
  .status-queued {
    --s: #3b82f6;
  }
  .status-running {
    --s: #f59e0b;
  }
  .status-running .body {
    box-shadow: 0 0 0 1px #f59e0b, 0 0 14px #f59e0b55;
    animation: pulse 1.1s ease-in-out infinite;
  }
  .status-done {
    --s: #22c55e;
  }
  .status-stale {
    --s: #eab308;
  }
  .status-stale .body {
    border-style: dashed;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 1px #f59e0b, 0 0 22px #f59e0b88;
    }
  }
  footer.status {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 5px 10px;
    border-top: 1px solid #27272a;
    background: #0d0d0f;
    font-size: 10px;
    line-height: 1.4;
    color: #a1a1aa;
  }
  footer.status .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--s, #52525b);
    flex: none;
    margin-top: 3px;
  }
  footer.status .label {
    flex: none;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--s, #a1a1aa);
    font-weight: 600;
  }
  footer.status .msg {
    flex: 1;
    min-width: 0;
  }

  /* Port labels — outside the body. */
  .port-label {
    position: absolute;
    transform: translateY(-50%);
    max-width: 100px;
    font-size: 9px;
    color: #a1a1aa;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    z-index: 5;
    text-shadow:
      0 0 3px #000,
      0 0 2px #000,
      0 0 1px #000;
  }
  .port-label.in {
    right: 100%;
    padding-right: 7px;
    text-align: right;
  }
  .port-label.out {
    left: 100%;
    padding-left: 7px;
  }

  /* Callout — always-visible speech bubble above the node. */
  .callouts {
    position: absolute;
    bottom: calc(100% + 7px);
    left: 0;
    right: 0;
    z-index: 7;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .tone-info {
    color: #fbbf24;
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
  }
  .callout-bubble .lbl {
    font-weight: 700;
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
    cursor: default;
    padding: 0 2px;
    font-size: 10px;
    line-height: 1;
  }
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
  .callouts > .callout-bubble:last-child::after {
    border-top-color: #0b0b0f;
    transform: translateY(-1px);
  }
</style>
