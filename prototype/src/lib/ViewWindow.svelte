<script lang="ts">
  import { untrack } from 'svelte';
  import type { NodeStatus } from './protocol';
  import type { ViewRenderer } from './view-contract';
  import { view as viewAction } from './viewAction';

  /**
   * A detached view window: the same framework-agnostic renderer the node
   * mounts inline (`use:viewAction`), but full-size, draggable, resizable and
   * closable so several can sit side-by-side. That side-by-side layout is the
   * substrate brushing & linking will later synchronise over — this component
   * deliberately stays a dumb viewer (it forwards `setViewState` but the host
   * wires it; multi-view sync is still deferred).
   *
   * Dependency-free on purpose (the zero-dep view ethos): drag/resize are a
   * dozen lines of Pointer Events, no window-manager library.
   */
  let {
    title,
    viewType,
    renderer,
    viewData,
    status,
    viewState,
    x,
    y,
    z,
    onClose,
    onFocus,
    onViewState,
  }: {
    title: string;
    viewType: string;
    renderer: ViewRenderer<unknown, unknown> | undefined;
    viewData: unknown;
    status: NodeStatus | undefined;
    viewState: Record<string, unknown>;
    x: number;
    y: number;
    z: number;
    onClose: () => void;
    onFocus: () => void;
    onViewState: (next: Record<string, unknown>) => void;
  } = $props();

  // The cascade position is a *starting* point: once open, the window owns
  // its geometry (you drag it). Capture the prop once, deliberately — later
  // prop changes (index shifts when another window closes) must not yank it.
  let pos = $state(untrack(() => ({ x, y })));
  let size = $state({ w: 520, h: 420 });

  // One generic pointer-drag helper for both the header (move) and the
  // bottom-right grip (resize); `apply` gets the delta from gesture start.
  function gesture(
    e: PointerEvent,
    apply: (dx: number, dy: number) => void
  ) {
    onFocus();
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      apply(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  const startMove = (e: PointerEvent) => {
    const ox = pos.x;
    const oy = pos.y;
    gesture(e, (dx, dy) => (pos = { x: ox + dx, y: oy + dy }));
  };
  const startResize = (e: PointerEvent) => {
    const ow = size.w;
    const oh = size.h;
    gesture(
      e,
      (dx, dy) =>
        (size = {
          w: Math.max(260, ow + dx),
          h: Math.max(180, oh + dy),
        })
    );
  };
</script>

<section
  class="view-window"
  style="left:{pos.x}px; top:{pos.y}px; width:{size.w}px; height:{size.h}px; z-index:{z}"
  onpointerdowncapture={onFocus}
>
  <!-- Drag handle: pointer-only window-manager affordance. The accessible
       action (close) is a real <button>; AT/keyboard users don't reposition
       a floating window. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={startMove}>
    <strong>{title}</strong>
    <span class="type">{viewType}</span>
    <button
      class="close nodrag"
      title="Close window"
      aria-label="Close window"
      onpointerdown={e => e.stopPropagation()}
      onclick={onClose}>×</button
    >
  </header>

  <div class="body">
    {#if !renderer}
      <div class="placeholder">▦ {viewType}<small>renderer pending</small></div>
    {:else if viewData == null}
      <div class="placeholder">
        ▦ {viewType}<small>
          {status === 'done' ? 'no data for view' : 'run the node to populate'}
        </small>
      </div>
    {:else}
      <div
        class="mount"
        use:viewAction={{
          renderer,
          data: viewData,
          viewState: viewState ?? {},
          onViewState,
        }}
      ></div>
    {/if}
  </div>

  <!-- Resize grip: same — pointer-only, no keyboard equivalent expected. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip" title="Resize" onpointerdown={startResize}></div>
</section>

<style>
  .view-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 260px;
    min-height: 180px;
    background: #18181b;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    box-shadow: 0 10px 40px #000b;
    overflow: hidden;
    font-size: 12px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 10px;
    background: #27272a;
    border-bottom: 1px solid #3f3f46;
    cursor: move;
    user-select: none;
    touch-action: none;
  }
  header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  header .type {
    color: #a1a1aa;
    font-size: 11px;
  }
  header .close {
    margin-left: auto;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #a1a1aa;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  header .close:hover {
    background: #3f3f46;
    color: #fff;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px;
  }
  /* Imperative views size to their container; the SVG ones redraw on resize
     via viewAction's ResizeObserver. */
  .mount {
    width: 100%;
    height: 100%;
  }
  .placeholder {
    height: 100%;
    display: grid;
    place-content: center;
    text-align: center;
    color: #a1a1aa;
    border: 1px dashed #3f3f46;
    border-radius: 6px;
  }
  .placeholder small {
    display: block;
    font-size: 10px;
    opacity: 0.7;
    margin-top: 4px;
  }
  .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    touch-action: none;
    background: linear-gradient(
      135deg,
      transparent 0 50%,
      #52525b 50% 60%,
      transparent 60% 70%,
      #52525b 70% 80%,
      transparent 80%
    );
  }
</style>
