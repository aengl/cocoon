<script lang="ts">
  import { untrack } from 'svelte';
  import { control as controlAction } from './controlAction';
  import type { ControlHook } from './control-render';

  /**
   * A detached control window — the `window` surface of a free-form control
   * (a visualisation is just one with a render hook and no `event`). A dumb
   * drag/resize shell that mounts the node's `controlWindowHtml` via the
   * generic `controlAction` shim and posts events back to the core. The node
   * decides how the window surface differs from the compact node one
   * (`ctx.surface`); this component just gives it room.
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
    /** The node id this control belongs to — tags the surface so a generic
     *  suggestion can address it (`data-cocoon-control`). */
    id: string;
    title: string;
    /** The node's one render hook (keystone 2/5), resolved by App through
     *  the shared `resolvedHook` and passed down as a pure prop. */
    hook: ControlHook | undefined;
    html: string | undefined;
    /** The node's `controlData` — fed to the render hook (keystone 2/5). */
    data: unknown;
    status: string | undefined;
    /** The node's code-declared preferred size (`control.window`). Used as
     *  the *initial* size; a user drag-resize then wins for this window's
     *  lifetime. May arrive after mount (lazy, like `html`). */
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
  // Once the user drag-resizes, their size wins — the node hint never
  // overrides a manual size (plain latch; only read inside the effect).
  let userSized = false;
  let size = $state(
    untrack(() => ({
      w: requestedSize?.width ?? 480,
      h: requestedSize?.height ?? 420,
    }))
  );
  // The hint is lazy (streams with `controlStatePatch`, possibly after
  // mount — e.g. opening a control before the first pull). Apply it when it
  // arrives, until the user has taken over. Reads `requestedSize` (a prop)
  // and writes `size` — never reads `size`, so not a self-referential effect.
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
    userSized = true; // the user's size now wins over the node hint
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
  style="left:{pos.x}px; top:{pos.y}px; width:{size.w}px; height:{size.h}px; z-index:{z}"
  onpointerdowncapture={onFocus}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={startMove}>
    <strong>{title}</strong>
    <span class="type">control{status ? ` · ${status}` : ''}</span>
    <button
      class="close nodrag"
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

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip" title="Resize" onpointerdown={startResize}></div>
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
    padding: 12px;
  }
  .mount {
    /* Reuse the global .control form/input/button shell from CocoonNode. */
    padding: 0;
    border: 0;
    background: transparent;
    /* Give the window's mount a *resolved* height so a control that fills
       its surface (`height:100%`, e.g. the tag-cloud hook) actually gets
       one. `.body` is a definite-height flex child, so 100% resolves; the
       inline node box gives an implicit height the same way. Without this
       a percentage-height chain collapses and an absolutely-positioned
       canvas renders into a zero-height box (invisible). */
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
