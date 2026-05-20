<script lang="ts">
  /**
   * Imperative-center helper for the callout carousel. Lives inside
   * `<SvelteFlow>` so `useSvelteFlow()` has the flow context (the same
   * constraint `FitOnLoad` operates under) — App.svelte sets `target` to a
   * node id and we animate the camera onto its centre, then clear the prop
   * so subsequent jumps to the same node still trigger.
   *
   * Deliberately tiny + reactive (no event listeners, no internal state):
   * the parent owns the carousel index; this just does the one effect side
   * the flow API can't do from outside SvelteFlow.
   */
  import { useSvelteFlow } from '@xyflow/svelte';

  let { target = $bindable() }: { target: string | undefined } = $props();

  const { getInternalNode, setCenter, getViewport } = useSvelteFlow();

  const ZOOM = 1.1; // a touch zoomed in so the badge is comfortably readable
  const DURATION = 400; // glide rather than jump — preserves orientation

  $effect(() => {
    const id = target;
    if (!id) return;
    const i = getInternalNode(id);
    if (!i) {
      // Node not measured yet (very-first paint). Defer one frame; if still
      // missing, give up — better than centering off-screen.
      requestAnimationFrame(() => {
        const j = getInternalNode(id);
        if (!j) {
          target = undefined;
          return;
        }
        const { x, y } = j.internals.positionAbsolute;
        const cx = x + (j.measured?.width ?? 0) / 2;
        const cy = y + (j.measured?.height ?? 0) / 2;
        const zoom = Math.max(getViewport().zoom, ZOOM);
        void setCenter(cx, cy, { zoom, duration: DURATION });
        target = undefined;
      });
      return;
    }
    const { x, y } = i.internals.positionAbsolute;
    const cx = x + (i.measured?.width ?? 0) / 2;
    const cy = y + (i.measured?.height ?? 0) / 2;
    // Preserve a user-zoomed-in view, but ensure we're at least readable.
    const zoom = Math.max(getViewport().zoom, ZOOM);
    void setCenter(cx, cy, { zoom, duration: DURATION });
    target = undefined;
  });
</script>
