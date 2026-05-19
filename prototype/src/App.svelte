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
  import { tick, untrack } from 'svelte';
  import CocoonNode from './lib/CocoonNode.svelte';
  import CocoonGroup from './lib/CocoonGroup.svelte';
  import FitOnLoad from './lib/FitOnLoad.svelte';
  import ControlWindow from './lib/ControlWindow.svelte';
  import SuggestionToast from './lib/SuggestionToast.svelte';
  import { createCore } from './lib/coreClient.svelte';
  import type { CocoonFile } from './lib/cocoon-file';
  import {
    COL_W,
    ROW_H,
    loadCocoonFile,
    serializeCocoonFile,
    type CocoonFlowNode,
  } from './lib/definition';
  import type { ChangeSet, NodeState, SuggestionVerdict } from './lib/protocol';
  import { provideNodeActions } from './lib/nodeActions';
  import { resolvedHook } from './lib/hookStore.svelte';
  import { saveViewport } from './lib/viewportStore';

  const core = createCore();
  core.connect(); // try the default ws://localhost:4000 immediately

  // The core is the sole source of truth: it owns the file *and* the data.
  // There is no offline preview — until the WebSocket hands us a graph the
  // canvas stays empty rather than flashing an unrelated skeleton.
  const connected = $derived(core.status === 'connected' && !!core.yaml);
  const source = $derived(connected ? core.yaml! : '');

  // Detached control windows: an ordered list of node ids (last = topmost /
  // most-recently-focused). Geometry lives inside each ControlWindow; this
  // is just the manager. Several open at once = the side-by-side substrate
  // brushing & linking will later sync over.
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
  // The detached control window stays pure-props: App resolves the hook
  // through the **one** shared resolver — the same `resolvedHook` the inline
  // node uses — and passes it down. No bespoke cache/effect here; the
  // resolver owns all of that.
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
          html: st?.controlWindowHtml,
          data: st?.controlData,
          status: st?.status,
        };
      })
      .filter(w => w !== undefined)
  );

  // --- presence: the editor announces its own ephemeral UI state ----------
  // Entirely optional + orthogonal (the core relays, interprets nothing).
  // The unsaved control drafts the human is typing (so a peer/agent reads
  // "what's pasted in the box"), the open control windows, the viewport, and
  // verdicts on collaborator change-sets.
  let drafts = $state<Record<string, Record<string, string>>>({});
  let resolved = $state<{ id: string; verdict: SuggestionVerdict }[]>([]);
  let viewport = $state<{ x: number; y: number; zoom: number } | undefined>();
  let canvasEl = $state<HTMLDivElement>();
  const reportDraft = (id: string, fields: Record<string, string>) =>
    (drafts = { ...drafts, [id]: fields });
  const recordResolved = (id: string, verdict: SuggestionVerdict) => {
    resolved = [...resolved.filter(r => r.id !== id), { id, verdict }].slice(
      -25
    );
    // A peer/agent is actively waiting on this — flush now, don't debounce.
    core.presence({ resolvedSuggestions: resolved }, true);
  };

  // Coalesced announce. Re-runs when any input changes; the send itself is
  // debounced in coreClient, so reading the frequently-reassigned `nodes`
  // (for visibleNodes) is fine.
  $effect(() => {
    const vp = viewport;
    const ns = nodes;
    const oc = controlWindowIds;
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
    core.presence({
      label: 'editor',
      openControls: oc,
      controlDrafts: dr,
      resolvedSuggestions: rs,
      ...(vp ? { viewport: vp } : {}),
      ...(visibleNodes ? { visibleNodes } : {}),
    });
  });

  /**
   * Apply a collaborator change-set (the suggestion model). Generic + node-
   * agnostic: each edit is `{node, field}` addressed by the form-`name`
   * convention the shim already uses — no node code, no schema. Atomic +
   * drift-validated: if any field is missing, or a `context` key that also
   * exists as a named field no longer matches (the surface moved on), the
   * whole change-set self-invalidates as `stale` (keystone-5 "don't trust a
   * stale snapshot"). On success the value is injected and an `input`/
   * `change` is dispatched so it behaves exactly as if typed (our own draft
   * capture then re-announces it as presence).
   */
  async function routeApply(cs: ChangeSet) {
    for (const e of cs.edits)
      if (!controlWindowIds.includes(e.node)) openControl(e.node);
    await tick();
    const esc = (s: string) =>
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s;
    type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    const resolveTargets = async () => {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const acc: { els: Field[]; value: string }[] = [];
        let ok = true;
        for (const e of cs.edits) {
          const surfaces = document.querySelectorAll<HTMLElement>(
            `[data-cocoon-control="${esc(e.node)}"]`
          );
          const els: Field[] = [];
          for (const s of surfaces) {
            const f = s.querySelector<Field>(`[name="${esc(e.field)}"]`);
            if (f) els.push(f);
            if (e.context)
              for (const [k, v] of Object.entries(e.context)) {
                const cf = s.querySelector<Field>(`[name="${esc(k)}"]`);
                if (cf && cf.value !== String(v)) return null; // drifted
              }
          }
          if (els.length === 0) {
            ok = false;
            break;
          }
          acc.push({ els, value: e.value });
        }
        if (ok) return acc;
        await new Promise(r => setTimeout(r, 60));
      }
      return null; // a field never appeared — treat as drift/stale
    };

    const targets = await resolveTargets();
    if (!targets) return recordResolved(cs.id, 'stale');
    for (const { els, value } of targets)
      for (const el of els) {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    recordResolved(cs.id, 'applied');
  }
  const routeDiscard = (cs: ChangeSet) => recordResolved(cs.id, 'discarded');

  // Hand the floating per-node action buttons a line to the core. Getters keep
  // `connected` reactive through the context boundary.
  provideNodeActions({
    get connected() {
      return connected;
    },
    process: id => core.process(id),
    invalidate: id => core.invalidate(id),
    setPersist: (id, value) => core.setPersist(id, value),
    setControl: (id, key, value) => core.setControl(id, key, value),
    controlEvent: (id, event, payload) => core.controlEvent(id, event, payload),
    reportDraft,
    openControl,
    get httpBase() {
      return core.httpBase;
    },
  });

  let file = $state.raw<CocoonFile>({ nodes: {} });
  let nodes = $state.raw<CocoonFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let baseEdges: Edge[] = [];

  // --- Dagre auto-layout (display only) --------------------------------
  // The loader still computes positions + autoCol/autoRow for the lossless
  // round-trip; this re-lays the graph for *display* with Dagre, once per
  // loaded file. LR only — it fits the node design (handles are hardcoded
  // Left=in / Right=out). Cocoon nodes vary wildly (a control/visualisation
  // node is far taller than a bare one) and aren't measured yet on first
  // paint, so a control-aware size estimate keeps the layout from
  // overlapping. We sync autoCol/autoRow to the placed position so an
  // undragged node still serialises churn-free (the editor owns only edges
  // + editor.col/row).
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
      (n.data.runtime?.controlHtml
        ? 320
        : Object.keys(n.data.params).length
          ? 120
          : 70),
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
    <span class="pill ok" title={core.url}>● {core.file}</span>
    <button
      class="refresh"
      title="Reload the flow from disk (full reset)"
      aria-label="Reload flow from disk"
      onclick={() => core.reload(true)}>↻</button
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

<div class="canvas" bind:this={canvasEl}>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    colorMode="dark"
    fitView
    onnodeclick={({ node }) =>
      connected && node.type === 'cocoon' && core.process(node.id)}
    onmove={(_e, vp) => (viewport = vp)}
    onmoveend={(event, vp) => {
      // Persist only genuine user gestures (event != null). Programmatic
      // moves — FitOnLoad's glide, the storage restore — pass null and must
      // not overwrite where the user actually left the camera.
      if (event) saveViewport(core.file, vp);
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

  {#each controlWindows as w, i (w.id)}
    <ControlWindow
      id={w.id}
      title={w.title}
      hook={w.hook}
      html={w.html}
      data={w.data}
      status={w.status}
      x={120 + i * 30}
      y={90 + i * 30}
      z={40 + i}
      onClose={() => closeControl(w.id)}
      onFocus={() => focusControl(w.id)}
      onEvent={(event, payload) => core.controlEvent(w.id, event, payload)}
      onDraft={fields => reportDraft(w.id, fields)}
    />
  {/each}

  <!-- Generic collaborator-suggestion toasts (keystone 5, the suggestion
       model). Editor-owned, node-agnostic; Apply routes by the form-`name`
       convention. Sits above every window. -->
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
