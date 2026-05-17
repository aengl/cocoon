<script lang="ts">
  import dagre from '@dagrejs/dagre';
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
  import CocoonGroup from './lib/CocoonGroup.svelte';
  import FitOnLoad from './lib/FitOnLoad.svelte';
  import ViewWindow from './lib/ViewWindow.svelte';
  import { views } from './lib/views';
  import type { ViewRenderer } from './lib/view-contract';
  import { createCore } from './lib/coreClient.svelte';
  import type { CocoonFile } from './lib/cocoon-file';
  import {
    COL_W,
    ROW_H,
    loadCocoonFile,
    serializeCocoonFile,
    type CocoonFlowNode,
  } from './lib/definition';
  import type { NodeState } from './lib/protocol';
  import { provideNodeActions } from './lib/nodeActions';
  import { saveViewport } from './lib/viewportStore';

  const core = createCore();
  core.connect(); // try the default ws://localhost:4000 immediately

  // The core is the sole source of truth: it owns the file *and* the data.
  // There is no offline preview — until the WebSocket hands us a graph the
  // canvas stays empty rather than flashing an unrelated skeleton.
  const connected = $derived(core.status === 'connected' && !!core.yaml);
  const source = $derived(connected ? core.yaml! : '');

  // Detached view windows: an ordered list of node ids (last = topmost /
  // most-recently-focused). Geometry lives inside each ViewWindow; this is
  // just the manager. Several open at once = the side-by-side layout
  // brushing & linking will later sync over.
  let windowIds = $state<string[]>([]);
  const openView = (id: string) => {
    windowIds = windowIds.includes(id)
      ? [...windowIds.filter(w => w !== id), id] // re-focus existing
      : [...windowIds, id];
  };
  const closeView = (id: string) =>
    (windowIds = windowIds.filter(w => w !== id));
  const focusView = (id: string) => {
    if (windowIds.at(-1) !== id)
      windowIds = [...windowIds.filter(w => w !== id), id];
  };

  // Resolve each open window's live render inputs reactively: the renderer
  // from the registry (browser runs only the render half), the already-
  // serialised payload + status streamed in node-state. Reading `nodes` and
  // `core.nodeStates` makes this recompute as the core streams updates.
  const windows = $derived(
    windowIds
      .map(id => {
        const node = nodes.find(n => n.id === id);
        if (!node?.data.view) return undefined;
        const st = core.nodeStates[id];
        return {
          id,
          title: node.data.label,
          viewType: node.data.view.type,
          renderer: views[node.data.view.type] as
            | ViewRenderer<unknown, unknown>
            | undefined,
          viewData: st?.viewData,
          status: st?.status,
          viewState:
            (node.data.viewState as Record<string, unknown>) ?? {},
        };
      })
      .filter(w => w !== undefined)
  );

  // Hand the floating per-node action buttons a line to the core. Getters keep
  // `connected` reactive through the context boundary.
  provideNodeActions({
    get connected() {
      return connected;
    },
    process: id => core.process(id),
    invalidate: id => core.invalidate(id),
    setPersist: (id, value) => core.setPersist(id, value),
    openView,
  });

  let file = $state.raw<CocoonFile>({ nodes: {} });
  let nodes = $state.raw<CocoonFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let baseEdges: Edge[] = [];

  // --- Dagre auto-layout (view layer only) -----------------------------
  // The loader still computes positions + autoCol/autoRow for the lossless
  // round-trip; this re-lays the graph for *display* with Dagre, once per
  // loaded file. LR only — it fits the node design (handles are hardcoded
  // Left=in / Right=out). Cocoon nodes vary wildly (a Scatterplot node is
  // far taller than a bare one) and aren't measured yet on first paint, so
  // a view-aware size estimate keeps the layout from overlapping. We sync
  // autoCol/autoRow to the placed position so an undragged node still
  // serialises churn-free (the editor owns only edges + editor.col/row).
  //
  // `editor.group` (a slash-path) becomes a Dagre *compound* cluster +
  // a synthesised Svelte Flow group node. Dagre lays everything out in
  // one absolute space; Svelte Flow wants child positions relative to
  // their direct parent and parents emitted before children — both are
  // pure arithmetic here. With no groups this reduces to the previous
  // plain pass (no clusters, no synthetic nodes, absolute coords).
  const nodeSize = (n: CocoonFlowNode) => ({
    width: n.measured?.width ?? 260,
    height:
      n.measured?.height ??
      (n.data.view ? 320 : Object.keys(n.data.params).length ? 120 : 70),
  });

  const GROUP_PREFIX = 'group:';
  // "A/B/C" -> ["A","A/B","A/B/C"] (every ancestor path, outer first).
  const ancestorPaths = (path: string) =>
    path
      .split('/')
      .map((_, i, p) => p.slice(0, i + 1).join('/'));

  function layout(
    ns: CocoonFlowNode[],
    es: Edge[]
  ): CocoonFlowNode[] {
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96 });

    // Every distinct group path (incl. intermediate ancestors) is a cluster.
    const groupPaths = new Set<string>();
    for (const n of ns)
      if (n.data.group)
        for (const p of ancestorPaths(n.data.group)) groupPaths.add(p);

    for (const p of groupPaths) g.setNode(GROUP_PREFIX + p, {});
    for (const n of ns) g.setNode(n.id, nodeSize(n));

    // Parent wiring: leaf -> deepest group; group -> its parent group.
    for (const n of ns)
      if (n.data.group) g.setParent(n.id, GROUP_PREFIX + n.data.group);
    for (const p of groupPaths) {
      const parts = p.split('/');
      if (parts.length > 1)
        g.setParent(
          GROUP_PREFIX + p,
          GROUP_PREFIX + parts.slice(0, -1).join('/')
        );
    }

    for (const e of es) g.setEdge(e.source, e.target);
    dagre.layout(g);

    const absTL = (id: string) => {
      const c = g.node(id);
      return { x: c.x - c.width / 2, y: c.y - c.height / 2 };
    };
    // Position relative to the direct parent cluster (xyflow semantics);
    // absolute when top-level.
    const placed = (id: string) => {
      const me = absTL(id);
      const pid = g.parent(id) as string | undefined;
      const off = pid ? absTL(pid) : { x: 0, y: 0 };
      return { parentId: pid, x: me.x - off.x, y: me.y - off.y };
    };

    // Synthesised group nodes, shallow paths first so a parent group is
    // always emitted before any child (group or leaf) — xyflow requires it.
    const groupNodes: CocoonFlowNode[] = [...groupPaths]
      .sort((a, b) => a.split('/').length - b.split('/').length)
      .map(path => {
        const id = GROUP_PREFIX + path;
        const c = g.node(id);
        const { parentId, x, y } = placed(id);
        return {
          id,
          type: 'group',
          position: { x, y },
          parentId,
          width: c.width,
          height: c.height,
          style: `width:${c.width}px;height:${c.height}px;`,
          // Draggable: grabbing the group moves it AND every parentId
          // child with it (xyflow sub-flow behaviour). Session-only —
          // the compound pass recomputes on every file load. Not
          // connectable/deletable: it's a synthetic display artifact,
          // never a real node.
          draggable: true,
          selectable: true,
          connectable: false,
          deletable: false,
          data: {
            label: path.split('/').at(-1)!,
            path,
            nodeType: '',
            params: {},
            viewState: undefined,
            inPorts: [],
            outPorts: [],
            hadEditorPos: false,
            autoCol: 0,
            autoRow: 0,
          },
        } as unknown as CocoonFlowNode;
      });

    const leafNodes = ns.map(n => {
      const { parentId, x, y } = placed(n.id);
      return {
        ...n,
        position: { x, y },
        parentId,
        data: {
          ...n.data,
          autoCol: Math.round(x / COL_W),
          autoRow: Math.round(y / ROW_H),
        },
      };
    });

    return [...groupNodes, ...leafNodes];
  }

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

  // Rebuild the graph when the core hands us a (different) file. Positions
  // come from the loader. No source yet (initial load / disconnected) = an
  // empty canvas, never a stale or unrelated graph.
  $effect(() => {
    if (!source) {
      untrack(() => {
        file = { nodes: {} };
        baseEdges = [];
        nodes = [];
        edges = [];
      });
      return;
    }
    const loaded = loadCocoonFile(source);
    untrack(() => {
      file = loaded.file;
      baseEdges = loaded.edges;
      nodes = layout(loaded.nodes, loaded.edges);
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

  const nodeTypes: NodeTypes = {
    cocoon: CocoonNode as never,
    group: CocoonGroup as never,
  };

  let showYaml = $state(false);
  // Offline: prove the lossless round-trip the way a text editor would.
  // Connected: the core owns the file, so just show what it sent.
  // Synthesised group nodes (`type:'group'`) are pure editor artifacts —
  // never written back, so the lossless round-trip is unaffected.
  const yaml = $derived(
    connected
      ? core.yaml!
      : serializeCocoonFile(
          file,
          nodes.filter(n => n.type === 'cocoon'),
          edges
        )
  );
</script>

<header class="bar">
  <strong>Cocoon</strong> · Svelte&nbsp;Flow prototype

  {#if connected}
    <span class="pill ok" title={core.url}>● core: {core.file}</span>
    <button
      class="refresh"
      title="Reload the flow from disk (full reset)"
      aria-label="Reload flow from disk"
      onclick={() => core.reload()}>↻</button
    >
  {:else}
    <span class="pill off"
      >○ {core.status === 'connecting' ? 'connecting…' : 'offline'}</span
    >
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
    onnodeclick={({ node }) =>
      connected && node.type === 'cocoon' && core.process(node.id)}
    onmoveend={(event, viewport) => {
      // Persist only genuine user gestures (event != null). Programmatic
      // moves — FitOnLoad's glide, the storage restore — pass null and must
      // not overwrite where the user actually left the camera.
      if (event) saveViewport(core.file, viewport);
    }}
  >
    <FitOnLoad
      trigger={source}
      states={core.nodeStates}
      fileKey={core.file}
    />
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

  {#each windows as w, i (w.id)}
    <ViewWindow
      title={w.title}
      viewType={w.viewType}
      renderer={w.renderer}
      viewData={w.viewData}
      status={w.status}
      viewState={w.viewState}
      x={90 + i * 30}
      y={70 + i * 30}
      z={20 + i}
      onClose={() => closeView(w.id)}
      onFocus={() => focusView(w.id)}
      onViewState={() => {
        /* brushing & linking lands here later (deferred): push viewState
           back to the core so downstream nodes + sibling views react. */
      }}
    />
  {/each}
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
  /* Sits next to the core pill, not pushed right with the YAML toggle.
     Negative margin pulls it in past the 16px flex gap. */
  .bar button.refresh {
    margin-left: -10px;
    padding: 2px 8px;
    font-size: 14px;
    line-height: 1;
    background: none;
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
  /* Kept for a future on-canvas layout/control panel (the Dagre experiment's
     panel was removed; auto-layout is now automatic). :global so Svelte
     doesn't flag it unused while no markup uses it yet. */
  :global(.layout-panel) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: #09090bdd;
    border: 1px solid #27272a;
    border-radius: 8px;
    font-size: 12px;
    color: #a1a1aa;
  }
  :global(.layout-panel button) {
    background: #27272a;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    padding: 3px 8px;
    cursor: pointer;
  }
  :global(.layout-panel button.on) {
    background: #14532d;
    color: #4ade80;
    border-color: #166534;
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

  /* Synthesised group nodes own all their chrome in CocoonGroup.svelte.
     Strip the library's default node-wrapper fill/border/padding so the
     only box is our single dashed outline (no darker outer border, no
     opaque panel stacking under the tint). */
  .canvas :global(.svelte-flow__node-group) {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    box-shadow: none;
  }
</style>
