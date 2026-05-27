<script lang="ts">
  import { untrack } from 'svelte';
  import { control as controlAction } from './controlAction';
  import type { ControlHook } from './protocol';

  /**
   * Detached `window` surface for a free-form control. A dumb drag/resize
   * shell that mounts the node's `controlWindowHtml` via the generic
   * `controlAction` shim and posts events back. The node decides how the
   * window surface differs from the inline one (via `ctx.surface`).
   */
  let {
    id,
    title,
    hook,
    html,
    data,
    status,
    size: requestedSize,
    x,
    y,
    z,
    onClose,
    onFocus,
    onEvent,
    onDraft,
  }: {
    /** Tags the surface (`data-cocoon-control`) so a generic suggestion can
     *  address its form fields. */
    id: string;
    title: string;
    hook: ControlHook | undefined;
    html: string | undefined;
    data: unknown;
    status: string | undefined;
    /** Node-declared preferred size. Initial only — a user drag then wins.
     *  May arrive after mount (lazy, like `html`). */
    size?: { width: number; height: number };
    x: number;
    y: number;
    z: number;
    onClose: () => void;
    onFocus: () => void;
    onEvent: (event: string, payload: Record<string, unknown>) => void;
    onDraft?: (fields: Record<string, string>) => void;
  } = $props();

  let pos = $state(untrack(() => ({ x, y })));
  // Once the user resizes, their size wins — the node hint never overrides.
  let userSized = false;
  let size = $state(
    untrack(() => ({
      w: requestedSize?.width ?? 480,
      h: requestedSize?.height ?? 420,
    }))
  );
  let fullscreen = $state(false);
  const toggleFullscreen = () => {
    fullscreen = !fullscreen;
    onFocus();
  };
  // Apply the hint when it arrives (it may stream in after mount), unless
  // the user has already taken over.
  $effect(() => {
    if (userSized || !requestedSize) return;
    size = { w: requestedSize.width, h: requestedSize.height };
  });

  function gesture(e: PointerEvent, apply: (dx: number, dy: number) => void) {
    onFocus();
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => apply(ev.clientX - sx, ev.clientY - sy);
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
    userSized = true;
    const ow = size.w;
    const oh = size.h;
    gesture(
      e,
      (dx, dy) =>
        (size = { w: Math.max(280, ow + dx), h: Math.max(200, oh + dy) })
    );
  };
</script>

<section
  class="control-window"
  class:fullscreen
  style={fullscreen
    ? `z-index:${z}`
    : `left:${pos.x}px; top:${pos.y}px; width:${size.w}px; height:${size.h}px; z-index:${z}`}
  onpointerdowncapture={onFocus}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={fullscreen ? undefined : startMove}>
    <strong>{title}</strong>
    <span class="type">control{status ? ` · ${status}` : ''}</span>
    <button
      class="icon-btn nodrag"
      title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      onpointerdown={e => e.stopPropagation()}
      onclick={toggleFullscreen}
      >{#if fullscreen}⤢{:else}⛶{/if}</button
    >
    <button
      class="icon-btn close nodrag"
      title="Close window"
      aria-label="Close window"
      onpointerdown={e => e.stopPropagation()}
      onclick={onClose}>×</button
    >
  </header>

  <div class="body">
    {#if html == null}
      <div class="placeholder">
        ▦ control<small>run the node to populate</small>
      </div>
    {:else}
      <div
        class="mount control"
        data-cocoon-control={id}
        use:controlAction={{ html, hook, data, onEvent, onDraft }}
      ></div>
    {/if}
  </div>

  {#if !fullscreen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip" title="Resize" onpointerdown={startResize}></div>
  {/if}
</section>

<style>
  .control-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 280px;
    min-height: 200px;
    background: #18181b;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    box-shadow: 0 10px 40px #000b;
    overflow: hidden;
    font-size: 12px;
  }
  .control-window.fullscreen {
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    border-radius: 0;
  }
  .control-window.fullscreen header {
    cursor: default;
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
  header .icon-btn {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #a1a1aa;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  header .icon-btn:first-of-type {
    margin-left: auto;
  }
  header .icon-btn.close {
    font-size: 16px;
  }
  header .icon-btn:hover {
    background: #3f3f46;
    color: #fff;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px;
  }
  .mount {
    /* Reuse the global `.control` form/input/button shell from CocoonNode. */
    padding: 0;
    border: 0;
    background: transparent;
    /* Resolve a definite height so a `height:100%` hook (e.g. a chart that
       fills its surface) actually gets one. Without this an absolutely-
       positioned canvas would render into a zero-height box. */
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
