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
  import CocoonGroup from './lib/CocoonGroup.svelte';
  import FitOnLoad from './lib/FitOnLoad.svelte';
  import CalloutCenter from './lib/CalloutCenter.svelte';
  import CalloutBar from './lib/CalloutBar.svelte';
  import ControlWindow from './lib/ControlWindow.svelte';
  import SuggestionToast from './lib/SuggestionToast.svelte';
  import { createCore } from './lib/coreClient.svelte';
  import { loadCocoonFile, type CocoonFlowNode } from './lib/definition';
  import type { NodeState, SuggestionVerdict } from './lib/protocol';
  import { provideNodeActions } from './lib/nodeActions';
  import { resolvedHook } from './lib/hookStore.svelte';
  import { saveViewport } from './lib/viewportStore';
  import { layout } from './lib/layout';
  import { STATUS_COLOR, decorate } from './lib/edgeDecor';
  import { callouts } from './lib/callouts.svelte';
  import { applyChangeSet } from './lib/suggestionRouter';
  import { copyToClipboard } from './lib/clipboard';

  const core = createCore();
  core.connect();

  // The core owns the file and the data. Until the WebSocket hands us a graph
  // the canvas stays empty rather than flashing an unrelated skeleton.
  const connected = $derived(core.status === 'connected' && !!core.yaml);
  const source = $derived(connected ? core.yaml! : '');

  // --- detached control windows ---------------------------------------------
  // Ordered ids, last = topmost. Geometry lives inside each ControlWindow.
  let controlWindowIds = $state<string[]>([]);
  const openControl = (id: string) => {
    controlWindowIds = controlWindowIds.includes(id)
      ? [...controlWindowIds.filter(w => w !== id), id]
      : [...controlWindowIds, id];
  };
  const closeControl = (id: string) =>
    (controlWindowIds = controlWindowIds.filter(w => w !== id));
  const focusControl = (id: string) => {
    if (controlWindowIds.at(-1) !== id)
      controlWindowIds = [...controlWindowIds.filter(w => w !== id), id];
  };
  // Window resolves its hook through the same `resolvedHook` the inline node
  // uses — App passes it down as a pure prop.
  const controlWindows = $derived(
    controlWindowIds
      .map(id => {
        const node = nodes.find(n => n.id === id);
        if (!node) return undefined;
        const st = core.nodeStates[id];
        return {
          id,
          title: node.data.label,
          hook: resolvedHook(
            core.httpBase,
            node.data.nodeType,
            st?.controlHook?.mtimeMs
          ),
          // The core elides `controlWindowHtml` when it matches `controlHtml`
          // (non-branching-render dedupe in runtime.ts/controlStatePatch).
          html: st?.controlWindowHtml ?? st?.controlHtml,
          data: st?.controlData,
          status: st?.status,
          size: st?.controlWindow,
        };
      })
      .filter(w => w !== undefined)
  );

  // --- presence: optional, orthogonal collaboration side-channel ------------
  let drafts = $state<Record<string, Record<string, string>>>({});
  let resolved = $state<{ id: string; verdict: SuggestionVerdict }[]>([]);
  let viewport = $state<{ x: number; y: number; zoom: number } | undefined>();
  let selectedNodes = $state<string[]>([]);
  let canvasEl = $state<HTMLDivElement>();
  const reportDraft = (id: string, fields: Record<string, string>) =>
    (drafts = { ...drafts, [id]: fields });
  const recordResolved = (id: string, verdict: SuggestionVerdict) => {
    resolved = [...resolved.filter(r => r.id !== id), { id, verdict }].slice(
      -25
    );
    // A peer/agent is actively waiting on this verdict — flush, don't debounce.
    core.presence({ resolvedSuggestions: resolved }, true);
  };

  // Coalesced presence broadcast. The send itself is debounced in coreClient.
  $effect(() => {
    const vp = viewport;
    const ns = nodes;
    const oc = controlWindowIds;
    const sel = selectedNodes;
    const dr = drafts;
    const rs = resolved;
    let visibleNodes: string[] | undefined;
    if (vp && canvasEl) {
      const W = canvasEl.clientWidth;
      const H = canvasEl.clientHeight;
      const left = -vp.x / vp.zoom;
      const top = -vp.y / vp.zoom;
      const right = left + W / vp.zoom;
      const bottom = top + H / vp.zoom;
      visibleNodes = ns
        .filter(n => n.type === 'cocoon')
        .filter(n => {
          const w = n.measured?.width ?? 260;
          const h = n.measured?.height ?? 80;
          return (
            n.position.x + w >= left &&
            n.position.x <= right &&
            n.position.y + h >= top &&
            n.position.y <= bottom
          );
        })
        .map(n => n.id);
    }
    // Echo callout labels + dismissals back so an agent learns its `C…`
    // number and sees its callouts acknowledged.
    const cl = callouts.labels;
    const cd = callouts.dismissed;
    const labelObj: Record<string, string> = {};
    for (const [id, label] of cl) labelObj[id] = label;
    core.presence({
      label: 'editor',
      openControls: oc,
      controlDrafts: dr,
      resolvedSuggestions: rs,
      ...(vp ? { viewport: vp } : {}),
      ...(visibleNodes ? { visibleNodes } : {}),
      ...(sel.length ? { selectedNodes: sel } : {}),
      ...(Object.keys(labelObj).length ? { calloutLabels: labelObj } : {}),
      ...(cd.size ? { dismissedCallouts: [...cd] } : {}),
    });
  });

  // --- callout ingestion ----------------------------------------------------
  // Reading `core.peers` is the only tracked dep; the store's writes happen
  // inside `untrack` so this effect doesn't self-trigger.
  $effect(() => {
    const peers = core.peers;
    untrack(() => callouts.ingest(peers));
  });

  // Hand node toolbars + windows a line to the core. Getters keep `connected`
  // and `httpBase` reactive through the context boundary.
  provideNodeActions({
    get connected() {
      return connected;
    },
    process: (id, opts) => core.process(id, opts),
    invalidate: id => core.invalidate(id),
    setPersist: (id, value) => core.setPersist(id, value),
    setControl: (id, key, value) => core.setControl(id, key, value),
    controlEvent: (id, event, payload) => core.controlEvent(id, event, payload),
    reportDraft,
    openControl,
    copyNodeId: copyToClipboard,
    dismissCallout: id => callouts.dismiss(id),
    get httpBase() {
      return core.httpBase;
    },
  });

  let nodes = $state.raw<CocoonFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let baseEdges: Edge[] = [];

  // --- graph load + layout --------------------------------------------------
  $effect(() => {
    if (!source) {
      untrack(() => {
        baseEdges = [];
        nodes = [];
        edges = [];
        relaidOutFor = '';
      });
      return;
    }
    const loaded = loadCocoonFile(source);
    untrack(() => {
      baseEdges = loaded.edges;
      nodes = layout(loaded.nodes, loaded.edges);
      edges = decorate(loaded.edges, core.nodeStates);
      relaidOutFor = '';
    });
  });

  // Dagre's first pass works from a size heuristic (nodes haven't rendered
  // yet). Tall content makes siblings stack; once xyflow has measured every
  // node, run it again with real sizes. One-shot per file load — the guard
  // is load-bearing since the new node objects start unmeasured and would
  // loop forever otherwise.
  let relaidOutFor: string = '';
  const relayout = () => {
    const real = nodes.filter(n => n.type === 'cocoon');
    if (!real.length) return;
    nodes = layout(real, baseEdges);
  };
  // F5 → re-layout. The browser default "reload page" is pointless here
  // (data lives in the core); a layout refresh after expanding a control is
  // the daily gesture. Skip while typing so Annotate textareas still see F5.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'F5' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
      return;
    const t = e.target as HTMLElement | null;
    const editable =
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable);
    if (editable) return;
    e.preventDefault();
    relayout();
  };
  $effect(() => {
    const src = source;
    const ns = nodes;
    if (!src || relaidOutFor === src) return;
    const real = ns.filter(n => n.type === 'cocoon');
    if (!real.length || !real.every(n => n.measured?.height)) return;
    untrack(() => {
      relaidOutFor = src;
      nodes = layout(real, baseEdges);
    });
  });

  // Merge streamed state + callouts into nodes WITHOUT disturbing live
  // (dragged) positions: map over the current nodes and only swap fields.
  $effect(() => {
    const states = core.nodeStates;
    const byNode = callouts.byNode;
    const labels = callouts.labels;
    untrack(() => {
      nodes = nodes.map(n => {
        const rt = states[n.id];
        const cs = byNode.get(n.id);
        const csWithLabels = cs?.map(c => ({ ...c, label: labels.get(c.id) }));
        if (n.data.runtime === rt && n.data.callouts === csWithLabels) return n;
        if (
          n.data.runtime === rt &&
          arraysShallowEqual(n.data.callouts as unknown[], csWithLabels)
        )
          return n;
        // Lift callout-carrying nodes above siblings — the speech-bubble
        // overlay lives in the node's own stacking context, so a later
        // sibling would otherwise paint over it.
        const zIndex = csWithLabels && csWithLabels.length > 0 ? 1000 : undefined;
        return {
          ...n,
          data: { ...n.data, runtime: rt, callouts: csWithLabels },
          zIndex,
        };
      });
      edges = decorate(baseEdges, states);
    });
  });

  function arraysShallowEqual(
    a: unknown[] | undefined,
    b: unknown[] | undefined
  ): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  const routeApply = (cs: import('./lib/protocol').ChangeSet) =>
    applyChangeSet(cs, {
      openControl,
      isOpen: id => controlWindowIds.includes(id),
      recordResolved,
    });
  const routeDiscard = (cs: import('./lib/protocol').ChangeSet) =>
    recordResolved(cs.id, 'discarded');

  const nodeTypes: NodeTypes = {
    cocoon: CocoonNode as never,
    group: CocoonGroup as never,
  };
</script>

<svelte:window onkeydown={onKey} />

<header class="bar">
  <strong>Cocoon</strong>

  {#if connected}
    <span class="pill ok" title={core.url}>● {core.file}</span>
    <button
      class="refresh"
      title="Reload the flow from disk (full reset)"
      aria-label="Reload flow from disk"
      onclick={() => core.reload(true)}>↻</button
    >
    <button
      class="relayout"
      title="Re-run auto-layout (F5)"
      aria-label="Re-run auto-layout"
      onclick={relayout}>⤢</button
    >
  {:else}
    <span class="pill off"
      >○ {core.status === 'connecting' ? 'connecting…' : 'offline'}</span
    >
  {/if}

  <CalloutBar
    visible={callouts.visible}
    cursor={callouts.cursor}
    labels={callouts.labels}
    onStep={d => callouts.step(d)}
  />
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
      <code>pnpm core serve &lt;your-cocoon.yml&gt;</code>, then connect.
    </div>
  </div>
{/if}

<div
  class="canvas"
  class:far-out={(viewport?.zoom ?? 1) < 0.6}
  bind:this={canvasEl}
>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    colorMode="dark"
    fitView
    minZoom={0.4}
    nodesConnectable={false}
    onselectionchange={({ nodes: sel }) => {
      // Mirror of agent→human callouts: announce the human's selection so the
      // agent can resolve "these nodes" without typing ids. Real cocoon nodes
      // only — synthetic groups are an editor artifact, not addressable.
      const next = sel
        .filter(n => n.type === 'cocoon')
        .map(n => n.id)
        .sort();
      if (
        next.length !== selectedNodes.length ||
        next.some((id, i) => id !== selectedNodes[i])
      )
        selectedNodes = next;
    }}
    onmove={(_e, vp) => (viewport = vp)}
    onmoveend={(event, vp) => {
      // Only persist genuine user gestures (event != null). FitOnLoad's
      // glide and the storage restore pass null — those must not overwrite
      // where the user actually left the camera.
      if (event) saveViewport(core.file, vp);
    }}
  >
    <FitOnLoad
      trigger={source}
      states={core.nodeStates}
      fileKey={core.file}
    />
    <CalloutCenter
      target={callouts.centerTarget}
      onClear={() => (callouts.centerTarget = undefined)}
    />
    <Background />
    <Controls />
    <MiniMap
      nodeColor={n =>
        STATUS_COLOR[
          (n.data as { runtime?: NodeState }).runtime?.status ?? 'idle'
        ]}
      nodeClass={n => (callouts.nodeSet.has(n.id) ? 'mini-callout' : '')}
    />
  </SvelteFlow>

  {#each controlWindows as w, i (w.id)}
    <ControlWindow
      id={w.id}
      title={w.title}
      hook={w.hook}
      html={w.html}
      data={w.data}
      status={w.status}
      size={w.size}
      x={120 + i * 30}
      y={90 + i * 30}
      z={40 + i}
      onClose={() => closeControl(w.id)}
      onFocus={() => focusControl(w.id)}
      onRun={() => core.process(w.id)}
      onEvent={(event, payload) => core.controlEvent(w.id, event, payload)}
      onDraft={fields => reportDraft(w.id, fields)}
    />
  {/each}

  <SuggestionToast
    peers={core.peers}
    onApply={routeApply}
    onDiscard={routeDiscard}
  />
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
    margin-left: auto;
  }
  /* Cluster the refresh/relayout buttons next to the core pill instead of
     being pushed right by the auto-margin. */
  .bar button.refresh,
  .bar button.relayout {
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
  /* Per-port count pill. `colorMode="dark"` already handles the contrast;
     only the pill shape is ours. */
  .canvas :global(.svelte-flow__edge-label) {
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid #3f3f46;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  /* Far-out zoom: count pills become unreadable, so hide them. The node
     body has a matching big-label overlay (`.zoom-overlay`). */
  .canvas.far-out :global(.svelte-flow__edge-label) {
    display: none;
  }

  /* CocoonGroup owns all its own chrome; strip the library's default node
     wrapper so only our dashed outline shows. */
  .canvas :global(.svelte-flow__node-group) {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    box-shadow: none;
  }

  /* Callout-flagged minimap nodes. `!important` beats xyflow's inline
     `style:fill`/`stroke`/`stroke-width`; `vector-effect` keeps the stroke
     visible regardless of minimap zoom. The shadow pulses (not the stroke
     — `!important` is ignored inside `@keyframes` per spec). */
  .canvas :global(.svelte-flow__minimap-node.mini-callout) {
    fill: #fbbf24 !important;
    stroke: #fbbf24 !important;
    stroke-width: 3 !important;
    vector-effect: non-scaling-stroke;
    animation: minimap-callout-pulse 2.2s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes minimap-callout-pulse {
    0%,
    100% {
      filter: drop-shadow(0 0 2px #fbbf2488);
    }
    50% {
      filter: drop-shadow(0 0 6px #fbbf24cc);
    }
  }
</style>
