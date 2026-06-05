<script lang="ts">
  import {
    Background,
    Controls,
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
  import MinimapNav from './lib/MinimapNav.svelte';
  import CalloutBar from './lib/CalloutBar.svelte';
  import ControlWindow from './lib/ControlWindow.svelte';
  import SuggestionToast from './lib/SuggestionToast.svelte';
  import { createCore } from './lib/coreClient.svelte';
  import { loadCocoonFile, type CocoonFlowNode } from './lib/definition';
  import type { NodeState, SuggestionVerdict } from './lib/protocol';
  import { provideNodeActions } from './lib/nodeActions';
  import { resolvedHook } from './lib/hookStore.svelte';
  import { saveViewport } from './lib/viewportStore';
  import { layout, collapseEdges, collapseRootMap } from './lib/layout';
  import { pushDownCollisions } from './lib/collision';
  import { STATUS_COLOR, decorate } from './lib/edgeDecor';
  import { callouts } from './lib/callouts.svelte';
  import { applyChangeSet } from './lib/suggestionRouter';
  import { copyToClipboard } from './lib/clipboard';

  const core = createCore();

  // Auto-connect to the default core, and keep retrying while offline — so the
  // editor latches on the moment a core comes up (or comes back), no manual
  // "connect" click. The offline page's button stays as an explicit override.
  $effect(() => {
    core.connect();
    const retry = setInterval(() => {
      if (core.status === 'disconnected') core.connect();
    }, 2000);
    return () => clearInterval(retry);
  });

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

  // Per-node "controls pinned open" — the human's explicit reveal (idea 2),
  // distinct from the transient frontier reveal (idea 1). Editor-local, never
  // YAML, never presence; reset on reload.
  let explicitReveal = $state<Record<string, boolean>>({});
  const toggleReveal = (id: string) =>
    (explicitReveal = { ...explicitReveal, [id]: !explicitReveal[id] });

  // Hand node toolbars + windows a line to the core. Getters keep `connected`
  // and `httpBase` reactive through the context boundary.
  provideNodeActions({
    get connected() {
      return connected;
    },
    process: (id, opts) => core.process(id, opts),
    cancel: id => core.cancel(id),
    invalidate: id => core.invalidate(id),
    setPersist: (id, value) => core.setPersist(id, value),
    setControl: (id, key, value) => core.setControl(id, key, value),
    resolveControls: id => core.resolveControls(id),
    toggleReveal,
    controlEvent: (id, event, payload) => core.controlEvent(id, event, payload),
    controlLog: (id, level, text) => core.controlLog(id, level, text),
    reportDraft,
    openControl,
    copyNodeId: copyToClipboard,
    toggleCollapse: path => toggleCollapse(path),
    dismissCallout: id => callouts.dismiss(id),
    get httpBase() {
      return core.httpBase;
    },
  });

  let nodes = $state.raw<CocoonFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let baseEdges: Edge[] = [];
  // The pristine loaded node set (every node, ungrouped), kept so a collapsed
  // group can fold its members away and still recover them on expand — the
  // displayed `nodes` no longer carries the suppressed members.
  let loadedNodes: CocoonFlowNode[] = [];

  // --- collapsible groups ---------------------------------------------------
  // Which `group:` paths are folded to a minimap box. The effective set is a
  // `persist`-style layering: the flow's authored `groups: { P: collapsed }`
  // default, then the session's manual toggles on top. The toggle is ephemeral
  // (never rewrites YAML); editing the default in the file re-applies to any
  // group the human hasn't touched this session.
  let collapsedGroups = $state<Set<string>>(new Set());
  let collapseDefaults = new Set<string>(); // from `groups:` in the flow file
  let collapseOverrides = new Map<string, boolean>(); // this session's toggles
  let collapseFile: string | undefined; // overrides reset when the flow changes
  const recomputeCollapsed = () => {
    const s = new Set(collapseDefaults);
    for (const [p, v] of collapseOverrides) v ? s.add(p) : s.delete(p);
    collapsedGroups = s;
  };
  // Re-layout from the pristine set, carrying over the measured sizes the
  // displayed nodes have already settled on (the source heuristic otherwise
  // undershoots tall content). Skip-only growth relief stays App's job.
  const layoutBase = (): CocoonFlowNode[] => {
    const measured = new Map(nodes.map(n => [n.id, n.measured]));
    return loadedNodes.map(n =>
      measured.has(n.id) ? { ...n, measured: measured.get(n.id) } : n
    );
  };
  const displayEdges = (): Edge[] =>
    decorate(
      collapseEdges(baseEdges, collapseRootMap(loadedNodes, collapsedGroups)),
      core.nodeStates
    );
  // Fold the live core state + callouts onto a node list. Reads the reactive
  // sources directly so it can run both inside the streaming $effect AND right
  // after any layout() — a re-layout rebuilds nodes from the pristine
  // `loadedNodes` (no runtime in their data, and a just-expanded member was
  // never in the displayed set), so without this pass an expanded group's
  // nodes would show no status until the next state change happens to arrive.
  const decorateNodes = (list: CocoonFlowNode[]): CocoonFlowNode[] => {
    const states = core.nodeStates;
    const byNode = callouts.byNode;
    const labels = callouts.labels;
    const pinned = explicitReveal;
    return list.map(n => {
      // Collapsed groups carry no runtime of their own — they mirror the
      // live status of every folded member as the status-grid squares.
      if (n.type === 'group') {
        if (!n.data.collapsed) return n;
        const memberIds = (n.data.memberIds as string[]) ?? [];
        const next = memberIds.map(id => states[id]?.status ?? 'idle');
        if (arraysShallowEqual(n.data.statuses as unknown[], next)) return n;
        return { ...n, data: { ...n.data, statuses: next } };
      }
      const rt = states[n.id];
      const cs = byNode.get(n.id);
      const csWithLabels = cs?.map(c => ({ ...c, label: labels.get(c.id) }));
      // Reveal an idle node's knobs when pinned (toolbar) or when the active
      // frontier reaches it — any direct upstream is non-idle.
      const controlsPinned = pinned[n.id] === true;
      const frontier =
        upstreamOf
          .get(n.id)
          ?.some(u => (states[u]?.status ?? 'idle') !== 'idle') ?? false;
      const revealControls = controlsPinned || frontier;
      const calloutsSame =
        n.data.callouts === csWithLabels ||
        arraysShallowEqual(n.data.callouts as unknown[], csWithLabels);
      if (
        n.data.runtime === rt &&
        calloutsSame &&
        n.data.revealControls === revealControls &&
        n.data.controlsPinned === controlsPinned
      )
        return n;
      // Lift callout-carrying nodes above siblings — the speech-bubble overlay
      // lives in the node's own stacking context, so a later sibling would
      // otherwise paint over it.
      const zIndex = csWithLabels && csWithLabels.length > 0 ? 1000 : undefined;
      return {
        ...n,
        data: {
          ...n.data,
          runtime: rt,
          callouts: csWithLabels,
          revealControls,
          controlsPinned,
        },
        zIndex,
      };
    });
  };
  const toggleCollapse = (path: string) => {
    collapseOverrides.set(path, !collapsedGroups.has(path));
    recomputeCollapsed();
    if (!loadedNodes.length) return;
    nodes = decorateNodes(layout(layoutBase(), baseEdges, collapsedGroups));
    edges = displayEdges();
    // Expanding brings members back with no measured size yet, so this first
    // pass sizes their group cluster from the heuristic and the dashed box
    // undershoots the (taller) real nodes. Re-arm the measured-relayout lock so
    // it re-tidies — and re-encloses the group — once xyflow has measured them.
    relaidOutFor = '';
    laidOutSig = '';
    clearTimeout(lockTimer);
    lockTimer = undefined;
  };
  // node id → its upstream node ids, rebuilt on load. Used to reveal an idle
  // node's steering knobs when the active frontier reaches it (any upstream
  // non-idle). A plain map: only ever read against the reactive node states.
  let upstreamOf = new Map<string, string[]>();

  // --- graph load + layout --------------------------------------------------
  $effect(() => {
    if (!source) {
      untrack(() => {
        baseEdges = [];
        loadedNodes = [];
        upstreamOf = new Map();
        nodes = [];
        edges = [];
        relaidOutFor = '';
        laidOutSig = '';
        clearTimeout(lockTimer);
        lockTimer = undefined;
      });
      return;
    }
    const loaded = loadCocoonFile(source);
    untrack(() => {
      baseEdges = loaded.edges;
      loadedNodes = loaded.nodes;
      // Switching to a different flow drops this session's manual toggles; a
      // same-file reload (YAML edit) keeps them so editing the `groups:`
      // default re-applies to untouched groups without clobbering the human's.
      if (core.file !== collapseFile) {
        collapseOverrides = new Map();
        collapseFile = core.file;
      }
      collapseDefaults = loaded.collapsedDefaults;
      recomputeCollapsed();
      upstreamOf = new Map();
      for (const e of loaded.edges) {
        const arr = upstreamOf.get(e.target);
        if (arr) arr.push(e.source);
        else upstreamOf.set(e.target, [e.source]);
      }
      nodes = decorateNodes(layout(loaded.nodes, loaded.edges, collapsedGroups));
      edges = displayEdges();
      relaidOutFor = '';
      laidOutSig = '';
      clearTimeout(lockTimer);
      lockTimer = undefined;
    });
  });

  // Dagre's first pass works from a size heuristic (nodes haven't rendered
  // yet). Tall content makes siblings stack; once xyflow has measured every
  // node, run it again with real sizes — but the *first* all-measured frame
  // isn't the final size: loading into a graph that already has state means a
  // `done`/`error` status footer renders a frame later and grows the node, so
  // a single one-shot would lock in pre-growth sizes and let siblings overlap.
  // Instead we re-layout on every change to the measured-height signature, then
  // lock after a settle window (`relaidOutFor`) so later growth stays a manual
  // F5 rather than a surprise mid-session reflow.
  const RELAYOUT_GRACE_MS = 4_000;
  let relaidOutFor: string = '';
  let laidOutSig = '';
  let lockTimer: ReturnType<typeof setTimeout> | undefined;
  const relayout = () => {
    if (!loadedNodes.length) return;
    nodes = decorateNodes(layout(layoutBase(), baseEdges, collapsedGroups));
    edges = displayEdges();
  };
  // F5 → re-layout. The browser default "reload page" is pointless here
  // (data lives in the core); a layout refresh after expanding a control is
  // the daily gesture. Skip while typing so Annotate textareas still see F5.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      recentsOpen = false;
      return;
    }
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

  // --- path-switch dropdown -------------------------------------------------
  // Click the file path → pick a recently served flow → the core re-points
  // itself (see coreClient.switchFile). The list comes from the core; we just
  // drop the current file from it.
  let recentsOpen = $state(false);
  const otherRecents = $derived(core.recents.filter(p => p !== core.file));
  // Display-only: abbreviate the core's home dir to `~`. Boundary-checked so
  // `/Users/aen` doesn't clip `/Users/aengl/…`. Wire paths stay absolute.
  const tildify = (p?: string) => {
    const h = core.home;
    if (!p || !h) return p ?? '';
    if (p === h) return '~';
    return p.startsWith(h + '/') ? '~' + p.slice(h.length) : p;
  };
  const baseName = (p: string) => p.split('/').pop() || p;
  const dirName = (p: string) => {
    const i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : '';
  };
  const switchTo = (p: string) => {
    recentsOpen = false;
    if (p !== core.file) core.switchFile(p);
  };
  // Tab title: "Cocoon • <parent_folder>/<yml_file_name>" once a flow is loaded.
  $effect(() => {
    const p = core.file;
    document.title = p ? `Cocoon • ${baseName(dirName(p))}/${baseName(p)}` : 'Cocoon';
  });
  const onWindowClick = (e: MouseEvent) => {
    if (!recentsOpen) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.path-wrap')) return; // toggle button / items handle it
    recentsOpen = false;
  };
  $effect(() => {
    const src = source;
    const ns = nodes;
    if (!src || relaidOutFor === src) return;
    const real = ns.filter(n => n.type === 'cocoon');
    if (!real.length || !real.every(n => n.measured?.height)) return;
    // Re-layout while the measured-height signature is still moving (status
    // footers grow nodes a frame after their state streams in). Stable sig =>
    // nothing to do. The lock timer, armed on the first pass, freezes the
    // arrangement once the settle window elapses.
    const sig = real
      .map(n => `${n.id}:${Math.round(n.measured?.height ?? 0)}`)
      .join('|');
    if (sig === laidOutSig) return;
    untrack(() => {
      laidOutSig = sig;
      nodes = decorateNodes(layout(layoutBase(), baseEdges, collapsedGroups));
      if (!lockTimer)
        lockTimer = setTimeout(() => {
          relaidOutFor = src;
          lockTimer = undefined;
        }, RELAYOUT_GRACE_MS);
    });
  });

  // Collision relief. After the load relayout locks, a node still grows
  // mid-session: pressing run reveals its steering knobs + a status footer, and
  // it crashes into the node below in the same column. Rather than a full F5
  // reflow (which discards manual positions), nudge only the lower node down by
  // the overlap — X stays frozen, columns stay intact. Keyed on a *size*
  // signature (not position) so it fires on growth, never on a drag; its own
  // writes change only Y, so they don't re-trigger it (no loop). After Dagre
  // has just reflowed there are no overlaps, so this is a no-op then.
  const sizeSig = $derived(
    nodes
      .map(
        n =>
          `${n.id}:${Math.round(n.measured?.width ?? 0)}x${Math.round(
            n.measured?.height ?? 0
          )}`
      )
      .join('|')
  );
  $effect(() => {
    sizeSig;
    untrack(() => {
      const relieved = pushDownCollisions(nodes);
      if (relieved !== nodes) nodes = relieved;
    });
  });

  // Merge streamed state + callouts into nodes WITHOUT disturbing live
  // (dragged) positions: `decorateNodes` only swaps fields. Touch the reactive
  // sources here so the effect re-runs on any of them; the decoration itself
  // re-reads them inside `untrack` (the same pass also runs after a layout).
  $effect(() => {
    void core.nodeStates;
    void callouts.byNode;
    void callouts.labels;
    void explicitReveal;
    untrack(() => {
      nodes = decorateNodes(nodes);
      edges = displayEdges();
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

<svelte:window onkeydown={onKey} onclick={onWindowClick} />

<header class="bar">
  <strong>Cocoon</strong>

  {#if connected}
    <div class="path-wrap">
      <button
        class="pill ok path-btn"
        title="{core.url} — switch flow"
        aria-haspopup="listbox"
        aria-expanded={recentsOpen}
        onclick={() => (recentsOpen = !recentsOpen)}>● {tildify(core.file)}</button
      >
      {#if recentsOpen}
        <ul class="recents" role="listbox">
          {#each otherRecents as p (p)}
            <li>
              <button onclick={() => switchTo(p)} title={tildify(p)}>
                <span class="rname">{baseName(p)}</span>
                <span class="rdir">{tildify(dirName(p))}</span>
              </button>
            </li>
          {:else}
            <li class="empty">no other recent flows</li>
          {/each}
        </ul>
      {/if}
    </div>
    <!-- Toolbar icons below are from the Hugeicons free set (MIT); see NOTICE.md -->
    <button
      class="refresh"
      title="Reload the flow from disk (full reset)"
      aria-label="Reload flow from disk"
      onclick={() => core.reload(true)}
      ><svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        ><path
          d="M20.4879 15C19.2524 18.4956 15.9187 21 12 21C7.02943 21 3 16.9706 3 12C3 7.02943 7.02943 3 12 3C15.7292 3 18.9286 5.26806 20.2941 8.5"
        /><path
          d="M15 9H18C19.4142 9 20.1213 9 20.5607 8.56066C21 8.12132 21 7.41421 21 6V3"
        /></svg
      ></button
    >
    <button
      class="relayout"
      title="Re-run auto-layout (F5)"
      aria-label="Re-run auto-layout"
      onclick={relayout}
      ><svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        aria-hidden="true"
        ><path
          d="M3.88884 9.66294C4.39329 10 5.09552 10 6.49998 10C7.90445 10 8.60668 10 9.11113 9.66294C9.32951 9.51702 9.51701 9.32952 9.66292 9.11114C9.99998 8.60669 9.99998 7.90446 9.99998 6.5C9.99998 5.09554 9.99998 4.39331 9.66292 3.88886C9.51701 3.67048 9.32951 3.48298 9.11113 3.33706C8.60668 3 7.90445 3 6.49998 3C5.09552 3 4.39329 3 3.88884 3.33706C3.67046 3.48298 3.48296 3.67048 3.33705 3.88886C2.99998 4.39331 2.99998 5.09554 2.99998 6.5C2.99998 7.90446 2.99998 8.60669 3.33705 9.11114C3.48296 9.32952 3.67046 9.51702 3.88884 9.66294Z"
        /><path
          d="M14.8888 9.66294C15.3933 10 16.0955 10 17.5 10C18.9044 10 19.6067 10 20.1111 9.66294C20.3295 9.51702 20.517 9.32952 20.6629 9.11114C21 8.60669 21 7.90446 21 6.5C21 5.09554 21 4.39331 20.6629 3.88886C20.517 3.67048 20.3295 3.48298 20.1111 3.33706C19.6067 3 18.9044 3 17.5 3C16.0955 3 15.3933 3 14.8888 3.33706C14.6705 3.48298 14.483 3.67048 14.337 3.88886C14 4.39331 14 5.09554 14 6.5C14 7.90446 14 8.60669 14.337 9.11114C14.483 9.32952 14.6705 9.51702 14.8888 9.66294Z"
        /><path
          d="M3.88884 20.6629C4.39329 21 5.09552 21 6.49998 21C7.90445 21 8.60668 21 9.11113 20.6629C9.32951 20.517 9.51701 20.3295 9.66292 20.1111C9.99998 19.6067 9.99998 18.9045 9.99998 17.5C9.99998 16.0955 9.99998 15.3933 9.66292 14.8889C9.51701 14.6705 9.32951 14.483 9.11113 14.3371C8.60668 14 7.90445 14 6.49998 14C5.09552 14 4.39329 14 3.88884 14.3371C3.67046 14.483 3.48296 14.6705 3.33705 14.8889C2.99998 15.3933 2.99998 16.0955 2.99998 17.5C2.99998 18.9045 2.99998 19.6067 3.33705 20.1111C3.48296 20.3295 3.67046 20.517 3.88884 20.6629Z"
        /><path
          d="M14.8888 20.6629C15.3933 21 16.0955 21 17.5 21C18.9044 21 19.6067 21 20.1111 20.6629C20.3295 20.517 20.517 20.3295 20.6629 20.1111C21 19.6067 21 18.9045 21 17.5C21 16.0955 21 15.3933 20.6629 14.8889C20.517 14.6705 20.3295 14.483 20.1111 14.3371C19.6067 14 18.9044 14 17.5 14C16.0955 14 15.3933 14 14.8888 14.3371C14.6705 14.483 14.483 14.6705 14.337 14.8889C14 15.3933 14 16.0955 14 17.5C14 18.9045 14 19.6067 14.337 20.1111C14.483 20.3295 14.6705 20.517 14.8888 20.6629Z"
        /></svg
      ></button
    >
    {#if core.switchError}
      <span class="switch-err" title={core.switchError}>⚠ switch failed</span>
    {/if}
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
    panOnScroll
    zoomOnPinch
    nodesConnectable={false}
    proOptions={{ hideAttribution: true }}
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
    <MinimapNav
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
      onLog={(level, text) => core.controlLog(w.id, level, text)}
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
    /* Own a stacking context above the canvas so the recents dropdown
       (position:absolute below) paints over SvelteFlow. */
    position: relative;
    z-index: 20;
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
    padding: 0;
    width: 36px;
    font-size: 18px;
    line-height: 1;
    background: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
  }
  .bar button.refresh svg,
  .bar button.relayout svg {
    width: 18px;
    height: 18px;
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
  /* Path-as-dropdown: looks like the green pill, behaves like a button. */
  .path-wrap {
    position: relative;
    display: inline-flex;
  }
  .bar button.path-btn {
    margin-left: 0;
    background: none;
    border-radius: 999px;
    cursor: pointer;
    font: inherit;
    max-width: 52ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar button.path-btn:hover {
    border-color: #22c55e;
  }
  .recents {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 260px;
    max-width: 60ch;
    max-height: 320px;
    overflow: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    box-shadow: 0 8px 24px #000a;
  }
  .bar .recents li button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    margin: 0;
    padding: 5px 8px;
    background: none;
    border: none;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    color: #e4e4e7;
  }
  .bar .recents li button:hover {
    background: #27272a;
  }
  .recents .rname {
    font-size: 12px;
  }
  .recents .rdir {
    max-width: 56ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: #71717a;
  }
  .recents li.empty {
    padding: 6px 8px;
    color: #71717a;
    font-size: 12px;
  }
  .switch-err {
    margin-left: -10px;
    color: #f87171;
    font-size: 12px;
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
