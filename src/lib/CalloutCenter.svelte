<script lang="ts">
  /**
   * Centers the canvas on a callout target. Lives inside `<SvelteFlow>` so
   * `useSvelteFlow()` has the flow context (same constraint as `FitOnLoad`).
   * Calls `onClear` once it has consumed a target so repeated jumps to the
   * same node still trigger.
   */
  import { useSvelteFlow } from '@xyflow/svelte';

  let {
    target,
    onClear,
  }: {
    target: string | undefined;
    onClear: () => void;
  } = $props();

  const { getInternalNode, setCenter, getViewport } = useSvelteFlow();

  const ZOOM = 1.1;
  const DURATION = 400;

  $effect(() => {
    const id = target;
    if (!id) return;
    const i = getInternalNode(id);
    if (!i) {
      // Node not measured yet on very-first paint. Defer one frame; if still
      // missing, give up — better than centering off-screen.
      requestAnimationFrame(() => {
        const j = getInternalNode(id);
        if (!j) return onClear();
        const { x, y } = j.internals.positionAbsolute;
        const cx = x + (j.measured?.width ?? 0) / 2;
        const cy = y + (j.measured?.height ?? 0) / 2;
        const zoom = Math.max(getViewport().zoom, ZOOM);
        void setCenter(cx, cy, { zoom, duration: DURATION });
        onClear();
      });
      return;
    }
    const { x, y } = i.internals.positionAbsolute;
    const cx = x + (i.measured?.width ?? 0) / 2;
    const cy = y + (i.measured?.height ?? 0) / 2;
    const zoom = Math.max(getViewport().zoom, ZOOM);
    void setCenter(cx, cy, { zoom, duration: DURATION });
    onClear();
  });
</script>
