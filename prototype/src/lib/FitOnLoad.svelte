<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';

  // Re-centres the camera once per loaded graph. The Dagre auto-layout runs
  // in a post-mount effect, so Svelte Flow's `fitView` prop fits the *pre*-
  // layout positions — on bigger graphs the camera then lands in an empty
  // region. Refitting after the new nodes have laid out *and* been measured
  // (two frames is enough) keeps some nodes on screen. Must live inside
  // <SvelteFlow> so useSvelteFlow() has the flow context.
  let { trigger }: { trigger: unknown } = $props();

  const { fitView } = useSvelteFlow();

  $effect(() => {
    trigger; // re-run whenever a different graph loads
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => fitView({ padding: 0.2 }));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });
</script>
