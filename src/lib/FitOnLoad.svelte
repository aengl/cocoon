<script lang="ts">
  /**
   * Positions the camera once per loaded graph. SvelteFlow's `fitView` prop
   * frames the pre-layout positions; the Dagre pass runs in a post-mount
   * effect, so we re-aim after layout + measurement (two RAFs). Must live
   * inside `<SvelteFlow>` so `useSvelteFlow()` has the flow context.
   *
   * Priority 0: a remembered viewport for this file (localStorage, keyed by
   * `fileKey`) wins outright. An explicit "leave me where I was" beats any
   * guess.
   *
   * Otherwise:
   *  1. If any node is at the data frontier — restored `done` with non-empty
   *     output ports, OR `running` (a persisted node mid-restore can stay
   *     here longer than the grace window) — centre the *rightmost* such
   *     node. That's the real resume point.
   *  2. Otherwise centre the *leftmost* node, ties broken topmost.
   *
   * Persisted nodes stream in asynchronously, so this re-runs as `states`
   * updates and follows the data further in — until the user moves or the
   * grace window elapses.
   */
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { NodeState } from './protocol';
  import { loadViewport } from './viewportStore';

  let {
    trigger,
    states,
    fileKey,
  }: {
    trigger: unknown;
    states: Record<string, NodeState>;
    fileKey: string | undefined;
  } = $props();

  const { getNodes, getInternalNode, setCenter, setViewport, getViewport } =
    useSvelteFlow();

  const ZOOM = 1;
  const GRACE_MS = 3_000;

  type V = { x: number; y: number; zoom: number };
  let loadAt = 0;
  let userMoved = false;
  let lastSet: V | null = null;
  let triedRestore = false;
  let restored = false;

  type Placed = { id: string; cx: number; cy: number };

  function placed(): Placed[] {
    return getNodes()
      .filter(n => n.type !== 'group')
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

  // Actively restoring/computing (`running`) or finished with non-empty
  // output. On a fresh load only persisted nodes reach either without being
  // processed — exactly the resume points.
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
      return withData.reduce((a, b) =>
        b.cx > a.cx || (b.cx === a.cx && b.cy < a.cy) ? b : a
      );
    return ps.reduce((a, b) =>
      b.cx < a.cx || (b.cx === a.cx && b.cy < a.cy) ? b : a
    );
  }

  function userHasMoved(): boolean {
    if (userMoved) return true;
    if (lastSet) {
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
    if (!triedRestore) {
      triedRestore = true;
      const saved = loadViewport(fileKey);
      if (saved) {
        restored = true;
        await setViewport(saved);
        lastSet = getViewport();
        return;
      }
    }
    if (restored) return;

    if (userHasMoved()) return;
    if (performance.now() - loadAt > GRACE_MS) return;
    const target = pickTarget(placed());
    if (!target) return;
    await setCenter(target.cx, target.cy, { zoom: ZOOM });
    lastSet = getViewport();
  }

  $effect(() => {
    trigger;
    loadAt = performance.now();
    userMoved = false;
    lastSet = null;
    triedRestore = false;
    restored = false;
  });

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
