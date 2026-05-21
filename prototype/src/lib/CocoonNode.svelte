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

  let { id, data }: NodeProps<Node<CocoonNodeData>> = $props();

  const actions = useNodeActions();

  // Contextual zoom — at low zoom the body's small text becomes unreadable,
  // so overlay a single big label (the node id) on top of the existing box.
  // The overlay does NOT change layout: it is `position:absolute; inset:0`
  // inside `.body`, so dagre's pass and every measured size are untouched.
  const viewport = useViewport();
  const farOut = $derived(viewport.current.zoom < 0.6);

  const paramKeys = $derived(Object.keys(data.params));

  // Literal `in:` params shown under the title as a faithful slice of the
  // YAML, so the node documents its own configuration in place. Code/URL
  // strings print raw (newlines kept); objects/arrays/scalars round back to
  // YAML. These are config, NOT ports — no connectable handle is drawn for
  // them (only edge-valued `in:` keys are ports; see definition.ts).
  const fmtParam = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : stringify(v).trimEnd();

  // Live processing state streamed from the core. Drives the node's colour
  // and the status line — the legacy editor only recoloured "executed"
  // nodes; here every lifecycle phase (queued / running / stale / error) is
  // distinct, and the summary the process() generator returns is shown
  // inline so it's clear what data the node holds without opening a control.
  const rt = $derived(data.runtime);
  const status = $derived(rt?.status ?? 'idle');

  // The node's one browser render hook (keystone 2/5), via the **single**
  // shared resolver — the exact same call `ControlWindow` makes through
  // `App` (one method, two call sites; no bespoke effect/cache here). Async
  // ⇒ may arrive after the HTML; `controlAction` mounts a late hook.
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

  // Effective persistence = the live runtime truth (a session toggle) if the
  // core has reported one, else the YAML default. Drives both the header tag
  // and which contextual actions apply.
  const effPersist = $derived(rt?.persist ?? data.persist ?? false);
  // Cache file on disk iff persist is on AND the node has a stored result.
  // `stale` drops the cache (guardrail), `error`/`queued`/`running`/`idle`
  // never wrote one, only `done` did — including a hydrated-from-disk done.
  const hasCache = $derived(effPersist && status === 'done');

  // Code-declared steering controls (keystone 5). Both the schema and the
  // effective values are core-owned and stream in node-state — the editor
  // never derives them from YAML and never writes them
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
    // Two overlapping squares — the standard "copy" affordance.
    copy: svg(
      'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z'
    ),
    check: svg('M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'),
  };
  type Action = {
    key: string;
    title: string;
    icon: string;
    active?: boolean;
    run: () => void;
  };
  // The "Copied!" affordance: a one-shot tick on the copy action for ~1s.
  // Pure UI feedback — `navigator.clipboard` is fire-and-forget; the editor
  // never round-trips through the core for clipboard ops.
  let copiedAt = $state(0);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  const just_copied = $derived(copiedAt > 0);
  const flashCopied = () => {
    copiedAt = performance.now();
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedAt = 0), 1100);
  };
  // A free-form control's detached window is opened from the
  // control's own "open" button (the shim's reserved `$open` →
  // `openControl`), not a toolbar action — the node decides whether
  // it has a window surface, not the editor chrome.
  //
  // Trash discards the node's whole result (output + state) and
  // any disk cache — useful for every node that has run, not just
  // persisted ones. Shown when there's something to discard: a settled
  // result/error, or a persisted node (which may hold a disk cache
  // even while idle this session).
  const showTrash = $derived(
    effPersist || status === 'done' || status === 'stale' || status === 'error'
  );
  const actionList = $derived<Action[]>(
    !actions
      ? []
      : [
          ...(!actions.connected
            ? []
            : [
                {
                  key: 'run',
                  title: 'Run to here',
                  icon: ICON.play,
                  run: () => actions.process(id),
                } satisfies Action,
                ...(showTrash
                  ? [
                      {
                        key: 'trash',
                        title: 'Clear result (and any cache)',
                        icon: ICON.trash,
                        run: () => actions.invalidate(id),
                      } satisfies Action,
                    ]
                  : []),
              ]),
          // Always present, even offline — copying the node id is local.
          {
            key: 'copy',
            title: just_copied ? 'Copied!' : 'Copy node id',
            icon: just_copied ? ICON.check : ICON.copy,
            active: just_copied,
            run: () => {
              actions.copyNodeId(id);
              flashCopied();
            },
          },
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

  // Agent-announced callouts targeting this node — the per-node half of the
  // App-level snapshot. Rendered as ALWAYS-VISIBLE speech bubbles stacked
  // directly above the node, with a downward tail. No click-to-expand: the
  // marker is the message; you read it, you act on it, you ✕ it. Multiple
  // callouts stack (newest closest to the node so the tail points at the
  // freshest pointer); the cluster's tail tone follows the worst severity.
  const callouts = $derived(data.callouts ?? []);
  const toneClass = (t: 'info' | 'warn' | 'error' | undefined) =>
    t === 'error' ? 'tone-error' : t === 'warn' ? 'tone-warn' : 'tone-info';
  const worstTone = $derived(
    callouts.some(c => c.tone === 'error')
      ? 'error'
      : callouts.some(c => c.tone === 'warn')
        ? 'warn'
        : 'info'
  );
</script>

<div class="cocoon-node status-{status}" class:far-out={farOut}>
  <!-- The visible box clips to its rounded corners; port labels live
       outside it (siblings of .body) so they read on the canvas. -->
  <div class="body">
    {#if farOut}
      <div class="zoom-overlay" aria-hidden="true">{data.label}</div>
    {/if}
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
      <span class="meta">
        <span class="type">{data.nodeType}</span>
        {#if effPersist}
          <span
            class="persist-flag"
            class:cached={hasCache}
            title={hasCache
              ? 'Cached on disk — click ▶ to re-run, 🗑 to drop'
              : 'Persistence on, no cache yet — runs once to populate'}
            aria-label={hasCache ? 'cache present' : 'persist on, no cache'}
          >
            {@html ICON.db}
          </span>
        {/if}
      </span>
    </header>

    <!-- Node docs: the grammar's `'?'`/`description` (definition.ts → doc),
         shown in place so a node self-documents on the canvas, not only on
         hover. Folded scalars (`>-`) arrive as one wrapped paragraph; `|`
         blocks keep their line breaks (pre-wrap). Inline markdown — links,
         `code`, **bold**, *italic* — is rendered by `renderInlineMarkdown`,
         which emits sanitised HTML (allow-listed tags only, hrefs limited
         to http(s)/mailto/file). Block structure stays the doc element's
         job via `pre-wrap`; the parser is deliberately inline-only. -->
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
      <!-- Free-form control (keystone 5, LiveView model): the core streams
           the node's rendered HTML; this generic shim mounts it and posts
           data-cocoon-event events back. HTML may carry a
           `data-cocoon-hook` element — author render JS delivered via the
           one disciplined path (keystone 2/5), the `wordcloud`-as-control
           case. Cocoon owns only the layout shell; the node owns the rest. -->
      <section
        class="control nodrag nopan nowheel"
        data-cocoon-control={id}
        use:controlAction={{
          html: rt.controlHtml,
          hook,
          data: rt.controlData,
          onEvent: (event, payload) =>
            actions?.controlEvent(id, event, payload),
          onOpen: () => actions?.openControl(id),
          onDraft: fields => actions?.reportDraft(id, fields),
        }}
      ></section>
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

  {#if callouts.length}
    <!-- Always-visible speech-bubble cluster sitting directly above the node.
         Lives OUTSIDE `.body` so it escapes the body's overflow-clip; positions
         relative to `.cocoon-node` (also position:relative). Multiple callouts
         stack vertically — the one closest to the node is the freshest (carries
         the tail). Tone tints border + label; the cluster's tail follows the
         worst severity so a single error pulls the eye even in a mixed stack. -->
    <div
      class="callouts nodrag nopan tail-{worstTone}"
      role="group"
      aria-label="{callouts.length} agent callout{callouts.length === 1 ? '' : 's'}"
    >
      {#each callouts as c (c.id)}
        <div class="callout-bubble {toneClass(c.tone)}">
          <span class="lbl" title={c.from ? `from ${c.from}` : undefined}
            >{c.label ?? '?'}</span
          >
          <span class="msg">{c.message}</span>
          <button
            type="button"
            class="dismiss"
            aria-label="Dismiss callout {c.label ?? ''}"
            title="Dismiss"
            onclick={e => fire(e, () => actions?.dismissCallout(c.id))}
            >✕</button
          >
        </div>
      {/each}
    </div>
  {/if}

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
  /* Contextual zoom — opaque overlay over the body, no layout impact.
     Font is sized in CSS px (which scale with the canvas zoom transform);
     ~20px renders ~8px on screen at zoom 0.4. The background tints toward
     the node's status colour so far-out canvases read as a colour map
     (legacy editor parity); idle falls back to the dark base. */
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
  }
  .cocoon-node.far-out .port-label {
    display: none;
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
  /* Right-side group: type label + (optional) persist flag. Keeps the
     header to two flex children so `space-between` pushes the title left
     and this group right — without it, three children spread mid-gap. */
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
  /* Persist signal — replaces the older ` · persist` text. Gray when
     persistence is declared but no cache file exists yet; orange when the
     node holds a cached result on disk (`status === 'done'` with persist
     on, including a hydrated-from-disk done). The header is `align-items:
     baseline`; a pure-SVG element has no text baseline and sits too high,
     so we re-center via `align-self`. */
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
  /* Quiet documentation block. Wraps freely (incl. long unbroken
     URLs/identifiers) and keeps any authored line breaks; the hairline
     matches the controls/control separators below. */
  .doc {
    margin: 0;
    padding: 6px 10px;
    color: #a1a1aa;
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border-bottom: 1px solid #27272a;
  }
  /* Inline markdown rendered by `renderInlineMarkdown`. The tags arrive via
     `{@html ...}`, so Svelte's scope-hashing doesn't reach them — the
     descendant part is `:global()`, anchored by the scoped `.doc` parent.
     Restrained palette: links lift toward the param-key blue (already in
     this card), `code` mirrors `.pk` so the two read as one vocabulary. */
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

  /* --- free-form control (keystone 5 action tier): generic defaults ONLY
     A node streams its own inert HTML *and its own <style>* (keystone 6 —
     the node's source is the contract; HTML/CSS is data, not code). This
     block is therefore strictly the generic dark-theme shell — form / input
     / button / typography — so an *unstyled* control (e.g. Annotate) still
     looks consistent. NOTHING node-specific belongs here: `.rater`,
     `.histo`, `.describe`, … live in their own node modules' rendered
     `<style>`. The markup is unscoped (set via innerHTML by the shim) so
     these are :global and reach both the inline node surface and the
     detached ControlWindow. */
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
  /* Generic typography defaults — a control with a heading / helper text
     looks right without shipping its own rules (node-specific styling lives
     in each node's streamed <style>, never here). */
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
    /* flex-start (not center) so the dot/label hug the first line when a
       long message wraps below, instead of floating to the block's middle. */
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
    /* centre the dot on the first text line (~14px line box, 7px dot). */
    margin-top: 3px;
  }
  footer.status .label {
    flex: none;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--s, #a1a1aa);
    font-weight: 600;
    white-space: nowrap;
  }
  /* Long status/error text breaks onto further lines (the node grows
     downward) rather than being clipped to one ellipsised line. */
  footer.status .msg {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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
  /* --- agent-announced callouts (always-visible speech bubbles) -------------
     Stacked vertically directly above the node, with a downward tail pointing
     at it (the cluster's `tail-<tone>` modifier carries the worst severity).
     The cluster sits OUTSIDE `.body` so it escapes the body's overflow-clip;
     positions relative to `.cocoon-node` (also position:relative) so it tracks
     the node as the canvas pans. Always shown — the marker IS the message;
     you read it, you act on it, you ✕ it. */
  .callouts {
    position: absolute;
    bottom: calc(100% + 7px); /* sit just above the node, leave room for the tail */
    left: 0;
    right: 0;
    z-index: 7;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    pointer-events: auto;
  }
  .tone-info {
    color: #fbbf24;
  }
  .tone-warn {
    color: #fb923c;
  }
  .tone-error {
    color: #f87171;
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
    box-shadow: 0 3px 10px #0006; /* one soft shadow — no double halo */
    font-size: 9.5px;
    line-height: 1.35;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .callout-bubble .lbl {
    font-weight: 700;
    color: currentColor;
    letter-spacing: 0.02em;
    font-size: 9px;
  }
  .callout-bubble .msg {
    color: #d4d4d8; /* readable on the dark bubble; tone is on label+border */
  }
  .callout-bubble .dismiss {
    background: transparent;
    color: #71717a;
    border: 0;
    cursor: pointer;
    padding: 0 2px;
    font-size: 10px;
    line-height: 1;
    align-self: start;
  }
  .callout-bubble .dismiss:hover {
    color: #fff;
  }
  /* Downward speech-bubble tail on the LAST bubble — the one closest to the
     node. Tone comes from the cluster's `tail-<tone>` modifier (worst
     severity). The 6/7 px difference draws a 1px border around the
     triangle by painting a fractionally larger triangle behind it. */
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
    /* The border outline (tinted by the cluster's worst-tone). */
    border-top-color: currentColor;
    transform: translate(-1px, 0);
    border-left-width: 7px;
    border-right-width: 7px;
  }
  .callouts.tail-info > .callout-bubble:last-child::before {
    color: #fbbf24;
  }
  .callouts.tail-warn > .callout-bubble:last-child::before {
    color: #fb923c;
  }
  .callouts.tail-error > .callout-bubble:last-child::before {
    color: #f87171;
  }
  .callouts > .callout-bubble:last-child::after {
    /* The inside fill — bubble background, drawn one pixel inset of the outline. */
    border-top-color: #0b0b0f;
    transform: translateY(-1px);
  }

  .act .ico {
    display: grid;
    place-items: center;
  }
  .act :global(svg) {
    display: block;
  }
</style>
