<script lang="ts">
  import {
    Handle,
    Position,
    type Node,
    type NodeProps,
  } from '@xyflow/svelte';
  import { stringify } from 'yaml';
  import type { CocoonNodeData } from './definition';
  import { useNodeActions } from './nodeActions';
  import { control as controlAction } from './controlAction';
  import { view as viewAction } from './viewAction';
  import { views } from './views';

  let { id, data }: NodeProps<Node<CocoonNodeData>> = $props();

  const actions = useNodeActions();

  // Framework-agnostic view renderers, resolved by type (Sparkline /
  // Inspector / Scatterplot). The pure data half already ran in the core;
  // the browser only mounts the render half with the streamed payload.
  const renderer = $derived(data.view ? views[data.view.type] : undefined);
  const viewData = $derived(data.runtime?.viewData);
  const paramKeys = $derived(Object.keys(data.params));

  // Literal `in:` params shown under the title as a faithful slice of the
  // YAML, so the node documents its own configuration in place. Code/URL
  // strings print raw (newlines kept); objects/arrays/scalars round back to
  // YAML. These keys are also rendered as input ports (outside labels).
  const fmtParam = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : stringify(v).trimEnd();

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

  // Effective persistence = the live runtime truth (a session toggle) if the
  // core has reported one, else the YAML default. Drives both the header tag
  // and which contextual actions apply.
  const effPersist = $derived(rt?.persist ?? data.persist ?? false);

  // Code-declared steering controls (keystone 5). Both the schema and the
  // effective values are core-owned and stream in node-state (like the view
  // payload) — the editor never derives them from YAML and never writes them
  // back. Rendered inline, kind → native input; setting one is a session
  // override that ages the node (set → stale → re-pull), no eager cascade.
  const controlEntries = $derived(
    rt?.controls ? Object.entries(rt.controls) : []
  );
  const controlState = $derived(
    (rt?.controlState ?? {}) as Record<string, unknown>
  );
  const setControl = (key: string, value: unknown) =>
    actions?.setControl(id, key, value);

  // Floating contextual actions. Pure descriptors so growing the set later is
  // a one-line addition here — the rendering/styling below stays untouched.
  // Minimal inline SVGs keep the node component zero-dependency.
  const svg = (path: string) =>
    `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="${path}"/></svg>`;
  const ICON = {
    play: svg('M8 5v14l11-7z'),
    db: svg(
      'M12 3c4.4 0 8 1.34 8 3v12c0 1.66-3.6 3-8 3s-8-1.34-8-3V6c0-1.66 3.6-3 8-3zm0 2C8.69 5 6 5.92 6 7s2.69 2 6 2 6-.92 6-2-2.69-2-6-2z'
    ),
    trash: svg(
      'M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1.2 11.2A2 2 0 0 1 14.8 22H9.2a2 2 0 0 1-2-1.8L6 9z'
    ),
    expand: svg('M4 4h7v2H6v5H4V4zm16 16h-7v-2h5v-5h2v7z'),
  };
  type Action = {
    key: string;
    title: string;
    icon: string;
    active?: boolean;
    run: () => void;
  };
  const actionList = $derived<Action[]>(
    !actions?.connected
      ? []
      : [
          {
            key: 'run',
            title: 'Run to here',
            icon: ICON.play,
            run: () => actions.process(id),
          },
          {
            key: 'persist',
            title: effPersist
              ? 'Persistence on — click to disable'
              : 'Enable persistence (cache to disk)',
            icon: ICON.db,
            active: effPersist,
            run: () => actions.setPersist(id, !effPersist),
          },
          // Pop the attached view into a detached, resizable window. Only
          // when there's a renderable view — and the toolbar is already
          // core-gated, so live data is what populates it.
          ...(data.view && renderer
            ? [
                {
                  key: 'open',
                  title: `Open ${data.view.type} in a window`,
                  icon: ICON.expand,
                  run: () => actions.openView(id),
                } satisfies Action,
              ]
            : []),
          // Trash discards the node's whole result (output + view + state) and
          // any disk cache — useful for every node that has run, not just
          // persisted ones. Shown when there's something to discard: a settled
          // result/error, or a persisted node (which may hold a disk cache
          // even while idle this session).
          ...(effPersist || status === 'done' || status === 'stale' || status === 'error'
            ? [
                {
                  key: 'trash',
                  title: 'Clear result (and any cache)',
                  icon: ICON.trash,
                  run: () => actions.invalidate(id),
                } satisfies Action,
              ]
            : []),
        ]
  );

  // Buttons live inside SvelteFlow, whose canvas-level node-click also runs
  // the node — swallow the event so a button press does exactly one thing.
  const fire = (e: MouseEvent, run: () => void) => {
    e.stopPropagation();
    run();
  };

  // Fall back to a single default port so isolated nodes still look like
  // nodes and stay connectable. Real port schemas arrive with the JS node
  // library; until then ports are whatever edges reference.
  const inPorts = $derived(data.inPorts.length ? data.inPorts : ['data']);
  const outPorts = $derived(data.outPorts.length ? data.outPorts : ['data']);
  const offset = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;
</script>

<div class="cocoon-node status-{status}" title={data.doc ?? ''}>
  <!-- The visible box clips to its rounded corners; port labels live
       outside it (siblings of .body) so they read on the canvas. -->
  <div class="body">
    {#if actionList.length}
      <div class="node-actions nodrag nopan">
        {#each actionList as a (a.key)}
          <button
            type="button"
            class="act"
            class:active={a.active}
            title={a.title}
            aria-label={a.title}
            aria-pressed={a.active ?? undefined}
            onclick={e => fire(e, a.run)}
          >
            <span class="ico">{@html a.icon}</span>
          </button>
        {/each}
      </div>
    {/if}

    <header>
      <strong>{data.label}</strong>
      <span class="type">{data.nodeType}{effPersist ? ' · persist' : ''}</span>
    </header>

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

    {#if controlEntries.length}
      <section class="controls nodrag nopan nowheel">
        {#each controlEntries as [key, c] (key)}
          <label class="ctrl ctrl-{c.kind}">
            <span class="cl">{c.label ?? key}</span>
            {#if c.kind === 'toggle'}
              <input
                type="checkbox"
                checked={!!controlState[key]}
                onchange={e => setControl(key, e.currentTarget.checked)}
              />
            {:else if c.kind === 'select'}
              <select
                value={String(controlState[key] ?? '')}
                onchange={e => setControl(key, e.currentTarget.value)}
              >
                {#each c.options as opt (opt)}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if c.kind === 'number'}
              <input
                type="number"
                value={Number(controlState[key] ?? 0)}
                min={c.min ?? undefined}
                max={c.max ?? undefined}
                step={c.step ?? undefined}
                onchange={e => setControl(key, e.currentTarget.valueAsNumber)}
              />
            {:else if c.multiline}
              <textarea
                rows="2"
                placeholder={c.placeholder ?? ''}
                value={String(controlState[key] ?? '')}
                onchange={e => setControl(key, e.currentTarget.value)}
              ></textarea>
            {:else}
              <input
                type="text"
                placeholder={c.placeholder ?? ''}
                value={String(controlState[key] ?? '')}
                onchange={e => setControl(key, e.currentTarget.value)}
              />
            {/if}
          </label>
        {/each}
      </section>
    {/if}

    {#if rt?.controlHtml}
      <!-- Free-form control (keystone 5 action tier, LiveView model): the
           core streams inert HTML the node rendered; this generic shim
           mounts it and posts data-cocoon-event events back. Cocoon owns
           only the layout shell (.control + global form/input styles); the
           node owns structure + behaviour. -->
      <section
        class="control nodrag nopan nowheel"
        use:controlAction={{
          html: rt.controlHtml,
          onEvent: (event, payload) =>
            actions?.controlEvent(id, event, payload),
          onOpen: () => actions?.openControl(id),
        }}
      ></section>
    {/if}

    {#if data.view}
      {#if !renderer}
        <div class="view-pending">
          ▦ {data.view.type}<small> renderer pending</small>
        </div>
      {:else if viewData == null}
        <div class="view-pending">
          ▦ {data.view.type}<small>
            {status === 'done'
              ? 'no data for view'
              : 'run to populate'}</small
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
  </div>

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
    /* Visible so the port labels can sit outside the box. The box itself
       (.body) is what clips to the rounded corners. */
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
  }
  /* Outside the box: inputs to the left of the left edge, outputs to the
     right of the right edge, clear of the handle. */
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
    flex-direction: column;
    gap: 4px;
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
  /* One line always; overflow (incl. multi-line code, collapsed to a
     single line) ellipsises — the full YAML value is in the tooltip. */
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
  /* --- steering controls (keystone 5): inline, kind-driven ------------- */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid #27272a;
    background: #1c1c20;
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
  .ctrl.ctrl-toggle {
    justify-content: space-between;
  }
  .ctrl.ctrl-toggle .cl {
    flex: 1;
  }
  .ctrl input[type='text'],
  .ctrl input[type='number'],
  .ctrl select,
  .ctrl textarea {
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
  .ctrl textarea {
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
  .ctrl input[type='checkbox'] {
    flex: none;
    accent-color: #8b5cf6;
    cursor: pointer;
  }
  .ctrl input:focus,
  .ctrl select:focus,
  .ctrl textarea:focus {
    outline: none;
    border-color: #8b5cf6;
  }

  /* --- free-form control (keystone 5 action tier): the Cocoon shell -----
     The node streams its own (inert) HTML; Cocoon only provides a styled
     layout so any control fits the general look. The markup is unscoped
     (set via innerHTML by the shim) so these are :global, like the views. */
  .control {
    padding: 8px 10px;
    border-top: 1px solid #27272a;
    background: #1c1c20;
  }
  :global(.control form) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  :global(.control label) {
    display: flex;
    flex-direction: column;
    gap: 3px;
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
  :global(.control .row) {
    display: flex;
    gap: 6px;
  }
  :global(.control button) {
    flex: 1;
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
  /* conveyor-rater (sandbox) — uses the same shell, just a little rhythm */
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
  :global(.control .rater),
  :global(.control .rater-compact) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: stretch;
  }
  :global(.control .rater-compact) {
    align-items: flex-start;
  }
  /* one row per batch item: title left, stars right */
  :global(.control .rate-row) {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-top: 1px solid #27272a;
  }
  :global(.control .rate-row .t) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e4e4e7;
  }
  :global(.control .rate-row .row) {
    flex: none;
    display: flex;
    gap: 3px;
  }
  :global(.control .rate-row .row button) {
    flex: none;
    padding: 2px 5px;
    font-size: 12px;
    letter-spacing: -2px;
  }
  /* the "rated since last pull, pull to commit" drift hint (not a gate) */
  :global(.control .commit),
  :global(.control .commit-hint) {
    color: #fbbf24;
  }
  :global(.control .commit-hint) {
    margin-top: 6px;
    font-size: 10px;
    border-top: 1px dashed #3f3f46;
    padding-top: 6px;
  }
  /* search facet (sandbox/rate) — the draft-blob "find a game" box */
  :global(.control .rater-search-wrap) {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  :global(.control .rater-search) {
    display: flex;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  :global(.control .rater-search input) {
    flex: 1;
    min-width: 0;
  }
  :global(.control .rater-search button),
  :global(.control .rater-search-wrap .clear) {
    flex: none;
  }
  :global(.control .search-label),
  :global(.control .queue-label) {
    margin: 4px 0 0;
    color: #c4b5fd;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  :global(.control .search-empty) {
    color: #a1a1aa;
    font-style: italic;
  }
  :global(.control .rate-row .badge) {
    flex: none;
    font-size: 9.5px;
    color: #71717a;
    white-space: nowrap;
  }
  :global(.control .rate-row .badge.rated) {
    color: #fbbf24;
  }
  :global(.control .rater hr.sep) {
    border: none;
    border-top: 1px solid #27272a;
    margin: 8px 0 2px;
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

  /* --- live status: colour-codes the whole node lifecycle ---
     `--s` is set on the root and inherited by .body (border) and the
     footer dot/label; the box-shadow/border-style decorations apply to
     .body so they hug the rounded box, not the label overflow. */
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

  /* --- floating contextual actions --------------------------------------
     A small panel that hovers over the node's top-right corner. Hidden
     until the node is hovered or keyboard-focused so the graph stays
     uncluttered; `nodrag`/`nopan` keep clicks from moving the canvas. */
  .node-actions {
    position: absolute;
    top: 5px;
    right: 5px;
    z-index: 5;
    display: flex;
    gap: 3px;
    padding: 3px;
    border-radius: 7px;
    background: #0d0d0fe6;
    border: 1px solid #3f3f46;
    box-shadow: 0 2px 10px #000a;
    opacity: 0;
    transform: translateY(-3px);
    pointer-events: none;
    transition:
      opacity 0.12s,
      transform 0.12s;
  }
  .cocoon-node:hover .node-actions,
  .cocoon-node:focus-within .node-actions {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  .act {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: #27272a;
    color: #d4d4d8;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .act:hover {
    background: #3f3f46;
    color: #fff;
  }
  .act:active {
    transform: translateY(1px);
  }
  .act.active {
    background: #14532d;
    color: #4ade80;
  }
  .act.active:hover {
    background: #166534;
    color: #86efac;
  }
  .act .ico {
    display: grid;
    place-items: center;
  }
  .act :global(svg) {
    display: block;
  }
</style>
