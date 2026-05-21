<script lang="ts">
  /**
   * Sits *inside* <SvelteFlow> so `useSvelteFlow()` has its context. Exposes
   * a `centerOn(id)` API to the parent that smoothly pans to a node's center
   * without changing zoom — so the camera follows the latest added node
   * rather than zooming out to fit everything.
   */
  import { useSvelteFlow } from '@xyflow/svelte';

  type API = { centerOn: (id: string, duration?: number) => void };
  let {
    setCamera,
    zoom = 1.2,
  }: { setCamera: (api: API) => void; zoom?: number } = $props();

  const { setCenter, getInternalNode } = useSvelteFlow();

  setCamera({
    centerOn: (id, duration = 800) => {
      const n = getInternalNode(id);
      if (!n) return;
      const { x, y } = n.internals.positionAbsolute;
      const w = n.measured?.width ?? 0;
      const h = n.measured?.height ?? 0;
      setCenter(x + w / 2, y + h / 2, { zoom, duration });
    },
  });
</script>
