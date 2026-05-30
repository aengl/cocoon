<script lang="ts">
  /**
   * Click-to-navigate minimap. Wraps xyflow's `<MiniMap>` and turns it into an
   * RTS-style overview: a click centers the canvas on the clicked world point,
   * and dragging scrubs the viewport so it follows the cursor (press, drag,
   * release). Lives inside `<SvelteFlow>` so `useSvelteFlow()` has the flow
   * context (same constraint as `CalloutCenter`/`FitOnLoad`).
   *
   * The minimap SVG's `viewBox` is already in world space, so we convert a
   * pointer position to a world coordinate with the SVG's screen CTM — no need
   * to know the minimap's scale/offset ourselves. The built-in `pannable`
   * relative-drag is turned off so it doesn't fight the absolute jump model.
   */
  import { MiniMap, useSvelteFlow, type Node } from '@xyflow/svelte';

  let {
    nodeColor,
    nodeClass,
  }: {
    nodeColor: (n: Node) => string;
    nodeClass: (n: Node) => string;
  } = $props();

  const { setCenter, getViewport } = useSvelteFlow();

  /** Convert a pointer event to a world coordinate via the minimap SVG's CTM. */
  function toWorld(svg: SVGSVGElement, e: PointerEvent): DOMPoint | null {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  }

  function centerOn(svg: SVGSVGElement, e: PointerEvent) {
    const p = toWorld(svg, e);
    if (!p) return;
    // Keep the current zoom; only the pan target moves. No duration while
    // scrubbing so it tracks the cursor 1:1; a short ease on the initial click.
    void setCenter(p.x, p.y, { zoom: getViewport().zoom });
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    // Capture the element now — `e.currentTarget` is nulled once this handler
    // returns, so the move/up closures below must not read it.
    const el = e.currentTarget as HTMLElement;
    const svg = el.querySelector<SVGSVGElement>('svg.svelte-flow__minimap-svg');
    if (!svg) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    centerOn(svg, e);

    const move = (ev: PointerEvent) => centerOn(svg, ev);
    const stop = (ev: PointerEvent) => {
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }
</script>

<MiniMap {nodeColor} {nodeClass} pannable={false} zoomable {onpointerdown} />
