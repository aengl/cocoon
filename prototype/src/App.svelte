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
  import CalloutCenter from './lib/CalloutCenter.svelte';
  import ControlWindow from './lib/ControlWindow.svelte';
  import SuggestionToast from './lib/SuggestionToast.svelte';
  import { createCore } from './lib/coreClient.svelte';
  import { loadCocoonFile, type CocoonFlowNode } from './lib/definition';
  import type {
    Callout,
    ChangeSet,
    NodeState,
    SuggestionVerdict,
  } from './lib/protocol';
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
          // Fall back to `controlHtml` when the window field is omitted —
          // the core elides `controlWindowHtml` when it would equal
          // `controlHtml` (the non-branching-render dedupe; see
          // runtime.ts/controlStatePatch).
          html: st?.controlWindowHtml ?? st?.controlHtml,
          data: st?.controlData,
          status: st?.status,
          size: st?.controlWindow,
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
  // The human's current canvas selection — the mirror of agent callouts.
  // Real cocoon node ids only; synthetic group artifacts are filtered out so
  // the agent never sees `group:foo/bar` here.
  let selectedNodes = $state<string[]>([]);
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
    // Echo the short labels & dismissals back so any agent learns its `C…`
    // number and sees that a callout was acknowledged. Pure naming + ack;
    // there is no text-reply channel in the editor — the human's words ride
    // chat, not presence.
    const cl = calloutLabels;
    const cd = calloutDismissed;
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

  // --- callouts: agent-announced per-node markers ---------------------------
  // Snapshot-on-observation (see protocol.ts `Callout` for the lifetime model).
  // Live peer callouts → snapshots Map keyed by the announcer's id; the
  // snapshot OUTLIVES the agent's disconnect so a fire-and-forget callout
  // stays visible. Dismissal is editor-local and cleared when an agent re-
  // announces the same id (resurrect — agent is calling out again).
  let calloutSnap = $state(new Map<string, Callout>());
  let calloutDismissed = $state(new Set<string>());
  // Short, chat-friendly labels (C1, C2, …) assigned in first-seen order.
  // Counter never recycles — references in chat stay stable through a session.
  let calloutLabels = $state(new Map<string, string>());
  let calloutSeq = 0;
  // Auto-center on the very first callout the editor ever sees this session
  // — the user can then navigate manually with the header carets.
  let calloutAutoCentered = false;
  let calloutCenterTarget = $state<string | undefined>();
  // Carousel cursor — which callout the ◀/▶ carets step through.
  let calloutCursor = $state(0);

  $effect(() => {
    // Ingest every live peer's `callouts[]`. Same-id supersede; resurrect
    // clears any prior dismissal. Snapshots are NEVER removed when presence
    // drops — only the human's ✕ removes them.
    //
    // Only `core.peers` is a deliberate tracked dep; every other read of the
    // callout `$state` happens inside `untrack` so a write here (the same
    // effect's own mutation) doesn't self-trigger a redundant second pass.
    const peers = core.peers;
    untrack(() => {
      let mutated = false;
      let firstNewId: string | undefined;
      const nextLabels = new Map(calloutLabels);
      const nextSnap = new Map(calloutSnap);
      const nextDismissed = new Set(calloutDismissed);
      for (const p of peers) {
        const list = p.data?.callouts;
        if (!Array.isArray(list)) continue;
        for (const c of list) {
          if (!c?.id || !c.node || typeof c.message !== 'string') continue;
          const fresh = !nextSnap.has(c.id);
          const prev = nextSnap.get(c.id);
          // Always store the latest message/tone (re-announce = update).
          nextSnap.set(c.id, {
            id: c.id,
            node: c.node,
            message: c.message,
            from: c.from,
            tone: c.tone,
            ts: c.ts ?? prev?.ts ?? Date.now(),
          });
          if (!nextLabels.has(c.id)) {
            nextLabels.set(c.id, `C${++calloutSeq}`);
            mutated = true;
            firstNewId ??= c.id;
          }
          if (fresh) mutated = true;
          else if (
            prev &&
            (prev.message !== c.message ||
              prev.node !== c.node ||
              prev.tone !== c.tone)
          )
            mutated = true;
          // Resurrect on re-announce of a dismissed id.
          if (nextDismissed.delete(c.id)) mutated = true;
        }
      }
      // Agent-side dismissals (`cocoon callout-clear <id>`): any peer
      // announcing `dismissedCallouts` is treated identically to the human
      // clicking ✕. Symmetric by design — the editor doesn't distinguish
      // its own dismissals from a peer's; once anyone has cleared a
      // callout, it stays cleared (until a re-announce resurrects it via
      // the loop above). This is how the agent closes the loop on its own
      // markers once the work behind them is done.
      for (const p of peers) {
        const dl = p.data?.dismissedCallouts;
        if (!Array.isArray(dl)) continue;
        for (const id of dl) {
          if (typeof id !== 'string') continue;
          if (!nextSnap.has(id)) continue; // unknown — ignore
          if (!nextDismissed.has(id)) {
            nextDismissed.add(id);
            mutated = true;
          }
        }
      }
      if (mutated) {
        calloutSnap = nextSnap;
        calloutLabels = nextLabels;
        calloutDismissed = nextDismissed;
      }
      if (firstNewId && !calloutAutoCentered) {
        calloutAutoCentered = true;
        const c = nextSnap.get(firstNewId);
        if (c) {
          calloutCenterTarget = c.node;
          // Cursor points at the first one so subsequent ▶ steps from there.
          const ordered = [...nextSnap.values()]
            .filter(x => !nextDismissed.has(x.id))
            .sort(
              (a, b) =>
                (a.ts ?? 0) - (b.ts ?? 0) ||
                (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            )
            .map(x => x.id);
          const i = ordered.indexOf(firstNewId);
          if (i >= 0) calloutCursor = i;
        }
      }
    });
  });

  /** Snapshot ordered for the carousel — stable by (ts, id) so the order
   *  doesn't shuffle as the agent updates messages. */
  function orderedCalloutIds(): string[] {
    return [...calloutSnap.values()]
      .filter(c => !calloutDismissed.has(c.id))
      .sort((a, b) =>
        (a.ts ?? 0) - (b.ts ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .map(c => c.id);
  }

  const visibleCallouts = $derived(
    orderedCalloutIds()
      .map(id => calloutSnap.get(id))
      .filter((c): c is Callout => !!c)
  );
  /** Node id -> the callouts pinned to it (preserving carousel order). */
  const calloutsByNode = $derived(
    (() => {
      const m = new Map<string, Callout[]>();
      for (const c of visibleCallouts) {
        const arr = m.get(c.node);
        if (arr) arr.push(c);
        else m.set(c.node, [c]);
      }
      return m;
    })()
  );
  const calloutNodeSet = $derived(new Set(calloutsByNode.keys()));

  /** Step the carousel to the next/prev visible callout and request a center. */
  function stepCallout(delta: 1 | -1) {
    if (!visibleCallouts.length) return;
    const n = visibleCallouts.length;
    const next = (((calloutCursor + delta) % n) + n) % n;
    calloutCursor = next;
    calloutCenterTarget = visibleCallouts[next].node;
  }

  function dismissCallout(id: string) {
    if (!calloutSnap.has(id) || calloutDismissed.has(id)) return;
    calloutDismissed = new Set([...calloutDismissed, id]);
    // Keep cursor in range as the carousel shrinks.
    const n = orderedCalloutIds().length;
    if (calloutCursor >= n) calloutCursor = Math.max(0, n - 1);
  }

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
    copyNodeId: id => {
      // navigator.clipboard is async + permissioned; fall back to a synchronous
      // execCommand path so the action always succeeds locally even when the
      // page is iframed without the clipboard permission.
      const writeFallback = (s: string) => {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      };
      if (navigator.clipboard?.writeText)
        navigator.clipboard.writeText(id).catch(() => writeFallback(id));
      else writeFallback(id);
    },
    dismissCallout,
    get httpBase() {
      return core.httpBase;
    },
  });

  let nodes = $state.raw<CocoonFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let baseEdges: Edge[] = [];

  // --- Dagre auto-layout (display only) --------------------------------
  // Dagre is the sole owner of node positions: the loader hands us all-zero
  // positions and this pass lays the graph out once per loaded file. LR
  // only — it fits the node design (handles are hardcoded Left=in /
  // Right=out). Cocoon nodes vary wildly (a control/visualisation node is
  // far taller than a bare one) and aren't measured yet on first paint,
  // so a control-aware size estimate keeps the layout from overlapping.
  // Nothing position-related is round-tripped back to YAML — `editor.col/
  // row` were dropped (the serializer now strips them).
  //
  // A node's top-level `group:` key (a slash-path) becomes a Dagre
  // *compound* cluster + a synthesised Svelte Flow group node. Dagre lays
  // everything out in one absolute space; Svelte Flow wants child
  // positions relative to their direct parent and parents emitted before
  // children — both are pure arithmetic here. With no groups this reduces
  // to the previous plain pass (no clusters, no synthetic nodes, absolute
  // coords).
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
          },
        } as unknown as CocoonFlowNode;
      });

    const leafNodes = ns.map(n => {
      const { parentId, x, y } = placed(n.id);
      return {
        ...n,
        position: { x, y },
        parentId,
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
  // come from Dagre (the loader returns {0,0}). No source yet (initial
  // load / disconnected) = an empty canvas, never a stale or unrelated
  // graph. We keep only the loader's edge list (baseEdges) — the parsed
  // file itself isn't needed past this point (the editor is a viewer; no
  // writer cares about the file model).
  $effect(() => {
    if (!source) {
      untrack(() => {
        baseEdges = [];
        nodes = [];
        edges = [];
      });
      return;
    }
    const loaded = loadCocoonFile(source);
    untrack(() => {
      baseEdges = loaded.edges;
      nodes = layout(loaded.nodes, loaded.edges);
      edges = decorate(loaded.edges, core.nodeStates);
    });
  });

  // Merge streamed node state in without disturbing dragged positions: map
  // over the *current* nodes (live positions) and only swap `data.runtime`
  // (and `data.callouts`, the same pattern — peer presence, snapshot-cached).
  $effect(() => {
    const states = core.nodeStates;
    const byNode = calloutsByNode;
    const labels = calloutLabels;
    untrack(() => {
      nodes = nodes.map(n => {
        const rt = states[n.id];
        const cs = byNode.get(n.id);
        // Attach the resolved short label so the badge needs no extra lookup.
        const csWithLabels = cs?.map(c => ({
          ...c,
          label: labels.get(c.id),
        }));
        if (n.data.runtime === rt && n.data.callouts === csWithLabels) return n;
        // Reference-stable when nothing changed to keep Svelte Flow's diff
        // from re-rendering the node body needlessly.
        if (
          n.data.runtime === rt &&
          arraysShallowEqual(n.data.callouts as unknown[], csWithLabels)
        )
          return n;
        return {
          ...n,
          data: { ...n.data, runtime: rt, callouts: csWithLabels },
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

  const nodeTypes: NodeTypes = {
    cocoon: CocoonNode as never,
    group: CocoonGroup as never,
  };

</script>

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
  {:else}
    <span class="pill off"
      >○ {core.status === 'connecting' ? 'connecting…' : 'offline'}</span
    >
  {/if}

  {#if visibleCallouts.length}
    <!-- Callout carousel: ◀ count ▶, jumps the canvas to the next/prev
         agent-announced marker. The count's title shows the current label
         + message so you don't have to find the node to read it. -->
    <div
      class="callout-bar"
      role="group"
      aria-label="Agent callouts"
      title={visibleCallouts[calloutCursor]
        ? `${calloutLabels.get(visibleCallouts[calloutCursor].id) ?? ''} on ${
            visibleCallouts[calloutCursor].node
          } — ${visibleCallouts[calloutCursor].message}`
        : ''}
    >
      <button
        class="caret"
        aria-label="Previous callout"
        title="Previous callout"
        disabled={visibleCallouts.length < 2}
        onclick={() => stepCallout(-1)}>◀</button
      >
      <span class="count" aria-live="polite">
        {#if visibleCallouts.length > 1}
          {calloutLabels.get(visibleCallouts[calloutCursor]?.id) ?? '?'}
          <span class="of">{calloutCursor + 1}/{visibleCallouts.length}</span>
        {:else}
          {calloutLabels.get(visibleCallouts[0].id) ?? '?'}
        {/if}
      </span>
      <button
        class="caret"
        aria-label="Next callout"
        title="Next callout"
        disabled={visibleCallouts.length < 2}
        onclick={() => stepCallout(1)}>▶</button
      >
    </div>
  {/if}

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
    nodesConnectable={false}
    onnodeclick={({ node }) =>
      connected && node.type === 'cocoon' && core.process(node.id)}
    onselectionchange={({ nodes: sel }) => {
      // Mirror of agent → human callouts: announce the human's selection so
      // the agent can resolve "these nodes" / "the highlighted ones". Only
      // real cocoon nodes — the synthetic `type:'group'` clusters are an
      // editor artifact, not addressable. Sort so a reordered fire from
      // xyflow doesn't churn the presence broadcast.
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
    <CalloutCenter
      bind:target={calloutCenterTarget}
    />
    <Background />
    <Controls />
    <MiniMap
      nodeColor={n =>
        STATUS_COLOR[
          (n.data as { runtime?: NodeState }).runtime?.status ?? 'idle'
        ]}
      nodeClass={n => (calloutNodeSet.has(n.id) ? 'mini-callout' : '')}
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
  /* The agent-callout carousel sits inline with the pill+refresh, NOT pushed
     right with the YAML toggle. Carets are amber (matches the marker ring +
     stale colour), the count is a chat-friendly short label (C1, C2, …). */
  .bar .callout-bar {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: -8px;
    padding: 1px 4px;
    border-radius: 999px;
    border: 1px solid #fbbf2455;
    background: #fbbf2410;
  }
  .bar .callout-bar .caret {
    margin: 0; /* defeat .bar button { margin-left:auto } */
    padding: 1px 6px;
    font-size: 11px;
    line-height: 1;
    background: transparent;
    color: #fbbf24;
    border-color: transparent;
  }
  .bar .callout-bar .caret:not(:disabled):hover {
    background: #fbbf2422;
  }
  .bar .callout-bar .caret:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .bar .callout-bar .count {
    color: #fde68a;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.02em;
    padding: 0 2px;
  }
  .bar .callout-bar .count .of {
    color: #a1a1aa;
    font-weight: 400;
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
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

  /* Callout-flagged nodes in the MiniMap. At ~112-node scale a thin stroke
     gets lost in the noise, so flagged rects get a solid amber fill + a
     stroke that overrides the rect's inline `style:fill`/`stroke`/
     `stroke-width` (CSS `!important` is allowed to beat inline styles), and
     a *gentle* pulsing drop-shadow so the eye can find them without being
     loud. The shadow pulses (not the stroke — `!important` is ignored inside
     `@keyframes` per spec); the `vector-effect` keeps the stroke at the
     same on-screen thickness regardless of minimap zoom. */
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
