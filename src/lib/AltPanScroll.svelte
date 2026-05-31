<script lang="ts">
  /**
   * Experiment: Option + two-finger swipe pans the canvas in both axes.
   *
   * By default xyflow treats a wheel/trackpad swipe as zoom (`zoomOnScroll`).
   * We don't want to change that baseline — instead, while the Option (Alt) key
   * is held, a capture-phase wheel listener on the flow pane translates the
   * raw `deltaX`/`deltaY` into a viewport pan and stops the event before
   * xyflow's own handler (a descendant) ever sees it, so there's no zoom.
   *
   * Lives inside `<SvelteFlow>` so `useSvelteFlow()` has the flow context
   * (same constraint as `FitOnLoad`/`CalloutCenter`/`MinimapNav`).
   */
  import { useSvelteFlow } from '@xyflow/svelte';
  import { onMount } from 'svelte';

  const { getViewport, setViewport } = useSvelteFlow();

  onMount(() => {
    const pane = document.querySelector<HTMLElement>('.svelte-flow__pane');
    if (!pane) return;

    function onWheel(e: WheelEvent) {
      if (!e.altKey) return; // only steal the gesture while Option is held
      // Capture phase + stopPropagation keeps the event from reaching xyflow's
      // descendant wheel handler, so the default zoom never fires.
      e.preventDefault();
      e.stopPropagation();
      const vp = getViewport();
      // A swipe down/right should move content the same direction the fingers
      // go — i.e. the viewport offset moves opposite the delta.
      void setViewport({ x: vp.x - e.deltaX, y: vp.y - e.deltaY, zoom: vp.zoom });
    }

    pane.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () =>
      pane.removeEventListener('wheel', onWheel, { capture: true });
  });
</script>
