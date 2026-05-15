<script lang="ts">
  import {
    Background,
    Controls,
    MiniMap,
    SvelteFlow,
    type Edge,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { untrack } from 'svelte';
  import CocoonNode from './lib/CocoonNode.svelte';
  import { createCore } from './lib/coreClient.svelte';
  import type { CocoonFile } from './lib/cocoon-file';
  import {
    loadCocoonFile,
    serializeCocoonFile,
    type CocoonFlowNode,
  } from './lib/definition';
  import type { NodeState } from './lib/protocol';
  import { provideNodeActions } from './lib/nodeActions';

  // Offline preview source: the canonical legacy fixtures, loaded raw — the
  // running app stays the back-compat demo even with no core attached.
  const fixtures = import.meta.glob('../../examples/*/cocoon.yml', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const examples = Object.fromEntries(
    Object.entries(fixtures).map(([p, y]) => [p.split('/').at(-2)!, y])
  );
  const names = Object.keys(examples).sort();
  let selected = $state(
    names.includes('simple-api') ? 'simple-api' : names[0]
  );

  const core = createCore();
  core.connect(); // try the default ws://localhost:4000 immediately

  // The core is the source of truth when connected; otherwise offline preview.
  const connected = $derived(core.status === 'connected' && !!core.yaml);
  const source = $derived(connected ? core.yaml! : examples[selected]);

  // Hand the floating per-node action buttons a line to the core. Getters keep
  // `connected` reactive through the context boundary.
  provideNodeActions({
    get connected() {
      return connected;
    },
    process: id => core.process(id),
    invalidate: id => core.invalidate(id),
    setPersist: (id, value) => core.setPersist(id, value),
  });

  let file = $state.raw<CocoonFile>({ nodes: {} });
  let nodes = $state.raw<CocoonFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let baseEdges: Edge[] = [];

  const STATUS_COLOR: Record<NodeState['status'], string> = {
    idle: '#52525b',
    queued: '#3b82f6',
    running: '#f59e0b',
    done: '#22c55e',
    stale: '#eab308',
    error: '#ef4444',
  };

  function decorate(
    base: Edge[],
    states: Record<string, NodeState>
  ): Edge[] {
    return base.map(e => {
      const src = states[e.source];
      const tgt = states[e.target];
      const count = src?.ports?.[e.sourceHandle ?? 'data'];
      return {
        ...e,
        animated:
          src?.status === 'running' || tgt?.status === 'running',
        label: count === undefined ? undefined : `${count}`,
        style: src
          ? `stroke:${STATUS_COLOR[src.status]};stroke-width:1.5`
          : undefined,
      } satisfies Edge;
    });
  }

  // Rebuild the graph when the source file changes (offline switch or the
  // core handing us a different file). Positions come from the loader.
  $effect(() => {
    const loaded = loadCocoonFile(source);
    untrack(() => {
      file = loaded.file;
      baseEdges = loaded.edges;
      nodes = loaded.nodes;
      edges = decorate(loaded.edges, core.nodeStates);
    });
  });

  // Merge streamed node state in without disturbing dragged positions: map
  // over the *current* nodes (live positions) and only swap `data.runtime`.
  $effect(() => {
    const states = core.nodeStates;
    untrack(() => {
      nodes = nodes.map(n =>
        n.data.runtime === states[n.id]
          ? n
          : { ...n, data: { ...n.data, runtime: states[n.id] } }
      );
      edges = decorate(baseEdges, states);
    });
  });

  const nodeTypes: NodeTypes = { cocoon: CocoonNode as never };

  let showYaml = $state(false);
  // Offline: prove the lossless round-trip the way a text editor would.
  // Connected: the core owns the file, so just show what it sent.
  const yaml = $derived(
    connected ? core.yaml! : serializeCocoonFile(file, nodes, edges)
  );
</script>

<header class="bar">
  <strong>Cocoon</strong> · Svelte&nbsp;Flow prototype

  {#if connected}
    <span class="pill ok" title={core.url}>● core: {core.file}</span>
  {:else}
    <span class="pill off">○ offline</span>
    <label>
      example
      <select bind:value={selected}>
        {#each names as n (n)}<option value={n}>{n}</option>{/each}
      </select>
    </label>
  {/if}

  <button onclick={() => (showYaml = !showYaml)}>
    {showYaml ? 'hide' : 'show'} YAML
  </button>
</header>

{#if !connected}
  <div class="connect">
    <strong>No core connected.</strong> The editor is a viewer — processing
    runs in a Node core that owns the data.
    <div class="row">
      <input
        spellcheck="false"
        bind:value={core.url}
        onkeydown={e => e.key === 'Enter' && core.connect()}
      />
      <button onclick={() => core.connect()}>
        {core.status === 'connecting' ? 'connecting…' : 'connect'}
      </button>
    </div>
    <div class="hint">
      Launch one locally:
      <code>cd prototype &amp;&amp; pnpm serve</code>
      <span class="dim"
        >(or <code
          >pnpm core serve &lt;your-cocoon.yml&gt;</code
        >), then connect.</span
      >
    </div>
  </div>
{/if}

<div class="canvas">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    colorMode="dark"
    fitView
    onnodeclick={({ node }) => connected && core.process(node.id)}
  >
    <Background />
    <Controls />
    <MiniMap
      nodeColor={n =>
        STATUS_COLOR[
          (n.data as { runtime?: NodeState }).runtime?.status ?? 'idle'
        ]}
    />
  </SvelteFlow>

  {#if showYaml}
    <pre class="yaml">{yaml}</pre>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 12px;
    background: #09090b;
    color: #e4e4e7;
    border-bottom: 1px solid #27272a;
    font-size: 13px;
  }
  .bar label {
    color: #a1a1aa;
  }
  .bar select,
  .bar button {
    background: #27272a;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .bar button {
    margin-left: auto;
  }
  .pill {
    font-size: 12px;
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid #3f3f46;
  }
  .pill.ok {
    color: #22c55e;
    border-color: #22c55e55;
  }
  .pill.off {
    color: #a1a1aa;
  }
  .connect {
    padding: 10px 14px;
    background: #1c1917;
    border-bottom: 1px solid #292524;
    color: #d6d3d1;
    font-size: 13px;
  }
  .connect .row {
    display: flex;
    gap: 8px;
    margin: 8px 0 6px;
  }
  .connect input {
    flex: 0 0 280px;
    background: #0c0a09;
    color: #e7e5e4;
    border: 1px solid #44403c;
    border-radius: 6px;
    padding: 4px 8px;
    font: inherit;
  }
  .connect button {
    background: #b45309;
    color: #fff;
    border: 0;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .connect .hint {
    font-size: 12px;
    color: #a8a29e;
  }
  .connect .hint .dim {
    color: #78716c;
  }
  .connect code {
    background: #0c0a09;
    color: #fbbf24;
    padding: 1px 6px;
    border-radius: 4px;
  }
  .canvas {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .yaml {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 380px;
    max-height: calc(100% - 24px);
    overflow: auto;
    margin: 0;
    padding: 12px;
    background: #09090bdd;
    color: #a5f3fc;
    border: 1px solid #27272a;
    border-radius: 8px;
    font-size: 11px;
    z-index: 10;
  }

  /* Edge labels (per-port item counts). Svelte Flow's default is white-on-
     near-white — an invisible blob on the light canvas. Override via the
     library's own CSS variables so it wins regardless of stylesheet order. */
  /* `colorMode="dark"` applies Svelte Flow's coherent dark theme to the
     canvas AND every native element (Controls, MiniMap, attribution), and
     already makes the edge label dark-bg/light-text. Only the count pill's
     shape is ours — the theme doesn't provide that. */
  .canvas :global(.svelte-flow__edge-label) {
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid #3f3f46;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
</style>
