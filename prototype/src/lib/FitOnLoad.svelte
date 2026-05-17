<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { NodeState } from './protocol';

  // Positions the camera once per loaded graph. The Dagre auto-layout runs in
  // a post-mount effect, so Svelte Flow's `fitView` prop frames the *pre*-
  // layout positions; we re-aim after the new nodes have laid out *and* been
  // measured (two frames). Must live inside <SvelteFlow> so useSvelteFlow()
  // has the flow context.
  //
  // Two-tier intent (priority order):
  //  1. If any node is at the *data frontier* — restored `done` with non-
  //     empty output ports, OR `running` (a persisted node whose disk cache
  //     is mid-restore, which for a big cache stays `running` far longer than
  //     the grace window before it flips to `done`) — centre the *rightmost*
  //     such node. That's the real resume point: data was persisted precisely
  //     to skip the gathering stages to its left.
  //  2. Otherwise centre the *leftmost* node (the flow's source), and of any
  //     tied at that x, the *topmost* one.
  //
  // Persisted nodes restore asynchronously ("they stream in"), so this re-
  // runs as `states` updates and the camera follows the data further in —
  // until the user moves the viewport, or a grace window elapses.
  let {
    trigger,
    states,
  }: { trigger: unknown; states: Record<string, NodeState> } = $props();

  const { getNodes, getInternalNode, setCenter, getViewport } =
    useSvelteFlow();

  const ZOOM = 1; // readable starting zoom (100%)
  const GRACE_MS = 3_000; // stop auto-aiming this long after a load
  const DURATION = 350; // ms — a quick, smooth glide rather than a jump

  type V = { x: number; y: number; zoom: number };
  let loadAt = 0;
  let userMoved = false;
  let aiming = false; // a setCenter glide owns the camera right now
  let lastSet: V | null = null;
  let lastTargetId: string | null = null;

  type Placed = { id: string; cx: number; cy: number };

  function placed(): Placed[] {
    return getNodes()
      .filter(n => n.type !== 'group') // group containers aren't "nodes"
      .map(n => {
        const i = getInternalNode(n.id);
        if (!i) return null;
        const { x, y } = i.internals.positionAbsolute;
        return {
          id: n.id,
          cx: x + (i.measured?.width ?? 0) / 2,
          cy: y + (i.measured?.height ?? 0) / 2,
        };
      })
      .filter((p): p is Placed => p !== null);
  }

  // A node is at the data frontier: actively restoring/computing (`running`
  // — a persisted node mid-restore can sit here longer than the grace
  // window, so treat it as data *now*, not once it finally flips), or
  // finished `done` with at least one non-empty output port. On a fresh load
  // only persisted nodes reach either without being processed — exactly the
  // resume points.
  function hasData(id: string): boolean {
    const rt = states[id];
    if (!rt) return false;
    if (rt.status === 'running') return true;
    return (
      rt.status === 'done' &&
      Object.values(rt.ports ?? {}).some(c => c > 0)
    );
  }

  function pickTarget(ps: Placed[]): Placed | undefined {
    if (ps.length === 0) return undefined;
    const withData = ps.filter(p => hasData(p.id));
    if (withData.length)
      // Rightmost; ties broken topmost.
      return withData.reduce((a, b) =>
        b.cx > a.cx || (b.cx === a.cx && b.cy < a.cy) ? b : a
      );
    // Leftmost; ties broken topmost.
    return ps.reduce((a, b) =>
      b.cx < a.cx || (b.cx === a.cx && b.cy < a.cy) ? b : a
    );
  }

  function userHasMoved(): boolean {
    if (userMoved) return true;
    // Don't sample mid-glide: the viewport is between targets then, which
    // would read as a user pan. Only compare once the camera has settled.
    if (!aiming && lastSet) {
      const v = getViewport();
      if (
        Math.abs(v.x - lastSet.x) > 0.5 ||
        Math.abs(v.y - lastSet.y) > 0.5 ||
        Math.abs(v.zoom - lastSet.zoom) > 0.001
      )
        userMoved = true;
    }
    return userMoved;
  }

  async function aim() {
    // One glide at a time: serialise so animations never fight (and a user
    // grab that interrupts the d3 transition simply stops auto-aiming).
    if (aiming) return;
    if (userHasMoved()) return;
    if (performance.now() - loadAt > GRACE_MS) return;
    const target = pickTarget(placed());
    if (!target || target.id === lastTargetId) return; // already centred there
    aiming = true;
    try {
      await setCenter(target.cx, target.cy, {
        zoom: ZOOM,
        duration: DURATION,
        interpolate: 'smooth',
      });
    } finally {
      aiming = false;
    }
    lastSet = getViewport(); // baseline for the next user-moved check
    lastTargetId = target.id;
    // A node further in may have restored during the glide — chase it.
    const next = pickTarget(placed());
    if (next && next.id !== lastTargetId) void aim();
  }

  // Reset the grace window & move tracking when a different graph loads.
  $effect(() => {
    trigger;
    loadAt = performance.now();
    userMoved = false;
    aiming = false;
    lastSet = null;
    lastTargetId = null;
  });

  // Re-aim on graph load and as persisted nodes stream in from disk.
  $effect(() => {
    trigger;
    states;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => void aim());
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });
</script>
