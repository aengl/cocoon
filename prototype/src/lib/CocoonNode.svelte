<script lang="ts">
  import {
    Handle,
    Position,
    type Node,
    type NodeProps,
  } from '@xyflow/svelte';
  import type { CocoonNodeData } from './definition';
  import { view as viewAction } from './viewAction';
  import { views } from './views';

  let { data }: NodeProps<Node<CocoonNodeData>> = $props();

  // Framework-agnostic view renderers, resolved by type (Sparkline /
  // Inspector / Scatterplot). The pure data half already ran in the core;
  // the browser only mounts the render half with the streamed payload.
  const renderer = $derived(data.view ? views[data.view.type] : undefined);
  const viewData = $derived(data.runtime?.viewData);
  const paramKeys = $derived(Object.keys(data.params));

  // Live processing state streamed from the core. Drives the node's colour
  // and the status line — the legacy editor only recoloured "executed"
  // nodes; here every lifecycle phase (queued / running / stale / error) is
  // distinct, and the summary the process() generator returns is shown
  // inline so it's clear what data the node holds without opening a view.
  const rt = $derived(data.runtime);
  const status = $derived(rt?.status ?? 'idle');
  const statusText = $derived(
    rt?.error
      ? rt.error
      : rt?.status === 'running'
        ? (rt.progress ?? 'processing…')
        : (rt?.summary ??
          (status === 'stale' ? 'upstream changed — click to re-run' : ''))
  );

  // Fall back to a single default port so isolated nodes still look like
  // nodes and stay connectable. Real port schemas arrive with the JS node
  // library; until then ports are whatever edges reference.
  const inPorts = $derived(data.inPorts.length ? data.inPorts : ['data']);
  const outPorts = $derived(data.outPorts.length ? data.outPorts : ['data']);
  const offset = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;
</script>

<div class="cocoon-node status-{status}" title={data.doc ?? ''}>
  {#each inPorts as port, i (port)}
    <Handle
      type="target"
      position={Position.Left}
      id={port}
      style="top: {offset(i, inPorts.length)}"
    />
    <span class="port-label in" style="top: {offset(i, inPorts.length)}">
      {port}
    </span>
  {/each}

  <header>
    <strong>{data.label}</strong>
    <span class="type">{data.nodeType}{data.persist ? ' · persist' : ''}</span>
  </header>

  {#if paramKeys.length}
    <ul class="params">
      {#each paramKeys as k (k)}
        <li><code>{k}</code></li>
      {/each}
    </ul>
  {/if}

  {#if data.view}
    {#if !renderer}
      <div class="view-pending">
        ▦ {data.view.type}<small> renderer pending</small>
      </div>
    {:else if viewData == null}
      <div class="view-pending">
        ▦ {data.view.type}<small>
          {status === 'done' ? 'no data for view' : 'run to populate'}</small
        >
      </div>
    {:else}
      <div
        class="view nodrag nowheel"
        use:viewAction={{
          renderer,
          data: viewData,
          viewState: (data.viewState as Record<string, unknown>) ?? {},
          onViewState: () => {},
        }}
      ></div>
    {/if}
  {/if}

  {#if rt && status !== 'idle'}
    <footer class="status">
      <span class="dot"></span>
      <span class="label">{status}</span>
      {#if statusText}<span class="msg" title={String(statusText)}
          >{statusText}</span
        >{/if}
    </footer>
  {/if}

  {#each outPorts as port, i (port)}
    <Handle
      type="source"
      position={Position.Right}
      id={port}
      style="top: {offset(i, outPorts.length)}"
    />
    <span class="port-label out" style="top: {offset(i, outPorts.length)}">
      {port}
    </span>
  {/each}
</div>

<style>
  .cocoon-node {
    position: relative;
    min-width: 200px;
    max-width: 260px;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    background: #18181b;
    color: #e4e4e7;
    font-size: 12px;
    overflow: hidden;
  }
  .port-label {
    position: absolute;
    transform: translateY(-50%);
    font-size: 9px;
    color: #71717a;
    pointer-events: none;
    white-space: nowrap;
  }
  .port-label.in {
    left: 8px;
  }
  .port-label.out {
    right: 8px;
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
  .type {
    color: #a1a1aa;
    font-size: 11px;
    white-space: nowrap;
  }
  .params {
    margin: 0;
    padding: 6px 10px;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .params code {
    background: #27272a;
    color: #93c5fd;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 11px;
  }
  .view {
    padding: 8px 10px 4px;
    max-height: 240px;
    overflow: auto;
  }
  /* Views mount plain (un-scoped) DOM, so style them globally. */
  :global(.cocoon-inspector) {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 10.5px;
    line-height: 1.55;
    color: #d4d4d8;
  }
  :global(.cocoon-inspector .toggle) {
    cursor: pointer;
    user-select: none;
  }
  :global(.cocoon-inspector .caret) {
    color: #71717a;
    margin-right: 3px;
  }
  :global(.cocoon-inspector .key) {
    color: #93c5fd;
  }
  :global(.cocoon-inspector .meta) {
    color: #71717a;
  }
  :global(.cocoon-inspector .val.num) {
    color: #f0abfc;
  }
  :global(.cocoon-inspector .val.str) {
    color: #86efac;
  }
  :global(.cocoon-inspector .val.bool),
  :global(.cocoon-inspector .val.null) {
    color: #fca5a5;
  }
  .view-pending {
    margin: 6px 10px 8px;
    padding: 10px;
    text-align: center;
    color: #a1a1aa;
    border: 1px dashed #3f3f46;
    border-radius: 6px;
  }
  .view-pending small {
    display: block;
    font-size: 10px;
    opacity: 0.7;
  }

  /* --- live status: colour-codes the whole node lifecycle --- */
  .cocoon-node {
    border-color: var(--s, #3f3f46);
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }
  .status-queued {
    --s: #3b82f6;
  }
  .status-running {
    --s: #f59e0b;
    box-shadow: 0 0 0 1px #f59e0b, 0 0 14px #f59e0b55;
    animation: pulse 1.1s ease-in-out infinite;
  }
  .status-done {
    --s: #22c55e;
  }
  .status-stale {
    --s: #eab308;
    border-style: dashed;
  }
  .status-error {
    --s: #ef4444;
    box-shadow: 0 0 0 1px #ef4444;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 1px #f59e0b, 0 0 22px #f59e0b88;
    }
  }
  footer.status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-top: 1px solid #27272a;
    background: #0d0d0f;
    font-size: 10px;
    color: #a1a1aa;
  }
  footer.status .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--s, #52525b);
    flex: none;
  }
  footer.status .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--s, #a1a1aa);
    font-weight: 600;
  }
  footer.status .msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
