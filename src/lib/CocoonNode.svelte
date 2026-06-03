<script lang="ts">
  import {
    Handle,
    Position,
    useViewport,
    type Node,
    type NodeProps,
  } from '@xyflow/svelte';
  import { stringify } from 'yaml';
  import type { CocoonNodeData } from './definition';
  import { useNodeActions } from './nodeActions';
  import { control as controlAction } from './controlAction';
  import { resolvedHook } from './hookStore.svelte';
  import { renderInlineMarkdown } from './markdown';
  import NodeCallouts from './NodeCallouts.svelte';
  import SteeringControls from './SteeringControls.svelte';
  import NodeToolbar, { type ToolbarAction } from './NodeToolbar.svelte';
  import { NODE_ICONS } from './nodeIcons';

  let { id, data }: NodeProps<Node<CocoonNodeData>> = $props();

  const actions = useNodeActions();

  // Contextual zoom: at low zoom the body's small text is unreadable, so
  // overlay the node id on top of the box without altering layout.
  const viewport = useViewport();
  const farOut = $derived(viewport.current.zoom < 0.6);

  const paramKeys = $derived(Object.keys(data.params));

  // Literal `in:` params: code/URL strings print raw (newlines kept);
  // structured values round through YAML. These are config, not ports
  // (see definition.ts — only `cocoon://` values are edges).
  const fmtParam = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : stringify(v).trimEnd();

  const rt = $derived(data.runtime);
  const status = $derived(rt?.status ?? 'idle');

  // The one render hook the node carries (same `resolvedHook` ControlWindow
  // uses). Async — may arrive after the HTML; `controlAction` mounts late.
  const hook = $derived(
    resolvedHook(actions.httpBase, data.nodeType, rt?.controlHook?.mtimeMs)
  );
  const statusText = $derived(
    rt?.error
      ? rt.error
      : rt?.status === 'running'
        ? (rt.progress ?? 'processing…')
        : (rt?.summary ??
          (status === 'stale' ? 'upstream changed — click to re-run' : ''))
  );

  // ms below 1s, one-decimal s above. Sub-millisecond rounds to 0 — fine,
  // that's a persist-restore fast-path or a no-op.
  const fmtDuration = (ms: number): string =>
    ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  const durationText = $derived(
    rt?.durationMs !== undefined &&
      (status === 'done' || status === 'stale' || status === 'error')
      ? fmtDuration(rt.durationMs)
      : ''
  );

  const effPersist = $derived(rt?.persist ?? data.persist ?? false);
  // Cache exists iff persist is on AND the node has a stored result. `stale`
  // drops the cache; `error`/`queued`/`running`/`idle` never wrote one.
  const hasCache = $derived(effPersist && status === 'done');

  const controlEntries = $derived(
    rt?.controls ? Object.entries(rt.controls) : []
  );
  const controlState = $derived(
    (rt?.controlState ?? {}) as Record<string, unknown>
  );
  const setControl = (key: string, value: unknown) =>
    actions?.setControl(id, key, value);

  // Steering knobs always render once a node has run (status ≠ idle, schema in
  // hand). Before the first run they stay hidden unless revealed — pinned via
  // the toolbar or reached by the active frontier (`data.revealControls`) — so
  // the human can set knobs *before* an expensive pull, not run-then-tweak.
  const revealControls = $derived(data.revealControls === true);
  const showControls = $derived(
    controlEntries.length > 0 && (status !== 'idle' || revealControls)
  );

  // Revealing an idle node asks the core to resolve its module so the schema
  // streams (the read-only half of setControl) — no process, no ageing. Guarded
  // so we ask once per reveal; reset when the reveal recedes so a later reveal
  // (e.g. after a reload) re-resolves. A control-less node just stays bare.
  let askedResolve = false;
  $effect(() => {
    if (!revealControls) {
      askedResolve = false;
      return;
    }
    if (status === 'idle' && !rt?.controls && !askedResolve) {
      askedResolve = true;
      actions?.resolveControls?.(id);
    }
  });

  // "Copied!" flash on the copy action.
  let copiedAt = $state(0);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  const justCopied = $derived(copiedAt > 0);
  const flashCopied = () => {
    copiedAt = performance.now();
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedAt = 0), 1100);
  };

  // Trash discards the result + any disk cache. Show whenever there's
  // something to discard — including a persisted node that may hold a cache
  // on disk while idle this session.
  const showTrash = $derived(
    effPersist || status === 'done' || status === 'stale' || status === 'error'
  );
  const actionList = $derived<ToolbarAction[]>(
    !actions
      ? []
      : [
          ...(!actions.connected
            ? []
            : status === 'running'
            ? // Mid-run: the only meaningful action is to stop it.
              [
                {
                  key: 'stop',
                  title: 'Stop — cancel this run',
                  icon: NODE_ICONS.stop,
                  run: () => actions.cancel(id),
                } satisfies ToolbarAction,
              ]
            : [
                {
                  key: 'run',
                  title:
                    'Run to here — shift-click to recompute stale upstream',
                  icon: NODE_ICONS.play,
                  run: (e?: MouseEvent) =>
                    actions.process(id, { rerunStale: e?.shiftKey === true }),
                } satisfies ToolbarAction,
                // Pre-run reveal: only meaningful before the first pull — a
                // node that has run shows its knobs anyway. Pins the controls
                // open (and resolves the schema) so they can be set first.
                ...(status === 'idle'
                  ? [
                      {
                        key: 'reveal',
                        title: data.controlsPinned
                          ? 'Hide pre-run controls'
                          : 'Reveal controls — set knobs before running',
                        icon: NODE_ICONS.tune,
                        active: data.controlsPinned === true,
                        run: () => actions.toggleReveal(id),
                      } satisfies ToolbarAction,
                    ]
                  : []),
                ...(showTrash
                  ? [
                      {
                        key: 'trash',
                        title: 'Clear result (and any cache)',
                        icon: NODE_ICONS.trash,
                        run: () => actions.invalidate(id),
                      } satisfies ToolbarAction,
                    ]
                  : []),
              ]),
          // Always present — copying the node id is local.
          {
            key: 'copy',
            title: justCopied ? 'Copied!' : 'Copy node id',
            icon: justCopied ? NODE_ICONS.check : NODE_ICONS.copy,
            active: justCopied,
            run: () => {
              actions.copyNodeId(id);
              flashCopied();
            },
          },
        ]
  );

  const inPorts = $derived(data.inPorts);
  const outPorts = $derived(data.outPorts);
  const offset = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;

  const callouts = $derived(data.callouts ?? []);
</script>

<div class="cocoon-node status-{status}" class:far-out={farOut}>
  <!-- Port labels live outside `.body` so they can render past the box's
       rounded clip; only `.body` clips its contents. -->
  <div class="body">
    {#if farOut}
      <div class="zoom-overlay" aria-hidden="true">{data.label}</div>
    {/if}

    <NodeToolbar actions={actionList} />

    <header>
      <strong>{data.label}</strong>
      <span class="meta">
        {#if data.nodeType !== data.label}
          <span class="type">{data.nodeType}</span>
        {/if}
        {#if effPersist}
          <span
            class="persist-flag"
            class:cached={hasCache}
            title={hasCache
              ? 'Cached on disk — click ▶ to re-run, 🗑 to drop'
              : 'Persistence on, no cache yet — runs once to populate'}
            aria-label={hasCache ? 'cache present' : 'persist on, no cache'}
          >
            {@html NODE_ICONS.db}
          </span>
        {/if}
      </span>
    </header>

    <!-- Node docs: the grammar's `?`/`description` rendered inline so a node
         self-documents on the canvas. `pre-wrap` keeps authored newlines;
         `renderInlineMarkdown` emits sanitised HTML (allow-listed tags
         only, hrefs limited to http(s)/mailto/file). -->
    {#if data.doc}
      <p class="doc">{@html renderInlineMarkdown(data.doc.trim())}</p>
    {/if}

    {#if paramKeys.length}
      <ul class="params">
        {#each paramKeys as k (k)}
          {@const v = fmtParam(data.params[k])}
          <li>
            <code class="pk">{k}</code>
            <span class="pv" title={v}>{v}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <SteeringControls
      entries={showControls ? controlEntries : []}
      state={controlState}
      {setControl}
    />

    {#if rt?.controlHtml}
      <!-- Free-form control: inert HTML from the core; interactivity rides
           `data-cocoon-event` attrs through the generic shim. A
           `data-cocoon-hook` element delegates to the node's one render
           hook. Cocoon owns the shell, the node owns the rest. -->
      <!-- No `nowheel` on the shell: a two-finger pan should pass straight
           through. A node whose control HTML has its own scrollable region
           opts that element in with `class="nowheel"` (same as the steering
           textarea) — the node owns the rest. -->
      <section
        class="control nodrag nopan"
        data-cocoon-control={id}
        use:controlAction={{
          html: rt.controlHtml,
          hook,
          data: rt.controlData,
          onEvent: (event, payload) =>
            actions?.controlEvent(id, event, payload),
          onLog: (level, text) => actions?.controlLog(id, level, text),
          onOpen: () => actions?.openControl(id),
          onDraft: fields => actions?.reportDraft(id, fields),
        }}
      ></section>
    {/if}

    {#if rt && status !== 'idle'}
      <footer class="status">
        <span class="dot"></span>
        <span class="badge">
          <span class="label">{status}</span>
          {#if durationText}
            <span
              class="duration"
              title={rt?.restoredFromCache
                ? `restored from ${rt.restoredFromCache}`
                : undefined}>{durationText}</span
            >
          {/if}
        </span>
        {#if statusText}<span class="msg" title={String(statusText)}
            >{statusText}</span
          >{/if}
      </footer>
    {/if}
  </div>

  <NodeCallouts items={callouts} onDismiss={id => actions?.dismissCallout(id)} />

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
    font-size: 12px;
    overflow: visible;
  }
  .body {
    position: relative;
    border: 1px solid var(--s, #3f3f46);
    border-radius: 8px;
    background: #18181b;
    color: #e4e4e7;
    overflow: hidden;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }
  /* Far-out overlay: opaque, no layout impact. Font size scales with the
     canvas zoom transform; ~20px ≈ 8px on screen at zoom 0.4. Tinted toward
     the status colour so a far-out canvas reads as a colour map. */
  .zoom-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    background: color-mix(in oklab, var(--s, #18181b) 55%, #18181b);
    color: #e4e4e7;
    font-size: 20px;
    font-weight: 600;
    text-align: center;
    overflow-wrap: anywhere;
    line-height: 1.1;
    pointer-events: none;
    z-index: 2;
  }
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
    /* Sit above the edge stroke; a black halo keeps the text readable when
       it overlaps a coloured edge. */
    z-index: 5;
    text-shadow:
      0 0 3px #000,
      0 0 2px #000,
      0 0 1px #000;
  }
  .cocoon-node.far-out .port-label {
    display: none;
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
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
    background: #27272a;
    border-bottom: 1px solid #3f3f46;
  }
  /* Two flex children only (title + meta) so `space-between` splits cleanly
     — three children spread mid-gap. */
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
  /* Persist flag: grey when persist is on with no cache yet; orange when a
     cache file is on disk. SVG has no text baseline so `align-self: center`
     re-centres it against the header's `align-items: baseline`. */
  .persist-flag {
    align-self: center;
    display: inline-flex;
    color: #52525b;
    line-height: 0;
    transition: color 0.15s;
  }
  .persist-flag :global(svg) {
    width: 14px;
    height: 14px;
  }
  .persist-flag.cached {
    color: #f97316;
  }
  .doc {
    margin: 0;
    padding: 6px 10px;
    color: #a1a1aa;
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* `{@html ...}` content is unscoped, so the descendant selectors must be
     `:global`. */
  .doc :global(a) {
    color: #93c5fd;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .doc :global(a:hover) {
    color: #bfdbfe;
  }
  .doc :global(code) {
    background: #27272a;
    color: #e4e4e7;
    border-radius: 3px;
    padding: 0 4px;
    font-size: 10.5px;
  }
  .doc :global(strong) {
    color: #d4d4d8;
    font-weight: 600;
  }
  .doc :global(em) {
    color: #d4d4d8;
    font-style: italic;
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
  /* The header carries its own (heavier) bottom border; suppress the inner
     hairline on the section that sits directly under it. */
  header + .params,
  header + :global(.controls),
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
  /* One line, overflow ellipsised — full value in the tooltip. */
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

  /* --- free-form control: generic dark *skin* only ----------------------
     A node streams its own HTML *and its own <style>* (the source is the
     contract). This block is strictly the generic colour/border/typography/
     focus skin so an unstyled control looks consistent — it deliberately
     imposes NO layout or spacing (no flex-direction, no flex-grow, no
     margins/gap). Layout is the node's own job and lives in each node module's
     streamed `<style>`, never here; baking column/grow/rhythm defaults in here
     only made every node fight to undo them — even a margin-top rhythm shifts
     the items of a row-form. The streamed markup is unscoped (`innerHTML`), so the rules are
     `:global` and reach both the inline node and the detached window. */
  .control {
    padding: 8px 10px;
    border-top: 1px solid #27272a;
    background: #1c1c20;
  }
  :global(.control label) {
    color: #c4b5fd;
    font-size: 10.5px;
  }
  :global(.control input),
  :global(.control select),
  :global(.control textarea) {
    background: #0d0d0f;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 4px;
    padding: 3px 5px;
    font: inherit;
    font-size: 10.5px;
  }
  :global(.control textarea) {
    font-family: ui-monospace, SFMono-Regular, monospace;
    resize: vertical;
  }
  :global(.control input:focus),
  :global(.control textarea:focus),
  :global(.control select:focus) {
    outline: none;
    border-color: #8b5cf6;
  }
  :global(.control button) {
    background: #27272a;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 5px;
    padding: 4px 10px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  :global(.control button:hover) {
    background: #3f3f46;
    color: #fff;
  }
  :global(.control .control-error) {
    margin: 0;
    color: #fca5a5;
    font-size: 10.5px;
    white-space: pre-wrap;
  }
  :global(.control h3) {
    margin: 4px 0;
    font-size: 14px;
    color: #f4f4f5;
  }
  :global(.control p) {
    margin: 2px 0;
    color: #a1a1aa;
    font-size: 10.5px;
  }

  /* --- live status colouring ---
     `--s` is set on the root and inherited by `.body` (border) and the
     footer dot/label. The box-shadow/border-style apply to `.body` so they
     hug the rounded box, not the overflow halo. */
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
  .status-error {
    --s: #ef4444;
  }
  .status-error .body {
    box-shadow: 0 0 0 1px #ef4444;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 1px #f59e0b, 0 0 22px #f59e0b88;
    }
  }
  footer.status {
    display: flex;
    /* baseline (not flex-start) so the dot, the STALE/etc. label, and the
       first line of the message all share one clean baseline — line-height
       differences between the badge (1.1) and the message (1.4) would
       otherwise leave their glyphs vertically misaligned. The stacked
       duration and any wrapped message lines hang below that shared baseline. */
    align-items: baseline;
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
    /* No baseline of its own, so the footer's `align-items: baseline` rests
       the dot's bottom edge on the shared baseline — a 7px dot then fills the
       cap height of the 10px label and reads as sitting on the same line. */
  }
  footer.status .badge {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;
    gap: 1px;
  }
  footer.status .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--s, #a1a1aa);
    font-weight: 600;
    white-space: nowrap;
  }
  footer.status .duration {
    font-size: 9px;
    color: #71717a;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    /* Restored-from-cache duration is sub-ms and meaningless; underline so
       the agent's `restoredFromCache` field has a visible twin in the UI. */
  }
  footer.status .duration[title] {
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
  footer.status .msg {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
